/**
 * HTTP route handlers for the magic-link auth flow.
 *
 * The handlers here speak in a small `AuthRequest` / `AuthResponse` shape
 * — not Node's `http.IncomingMessage` / `http.ServerResponse` directly —
 * so they're trivially unit-testable and can be reused across the runtime
 * server, future API gateways, or test harnesses without ceremony.
 *
 * Adapt the runtime server to call into them by mapping its
 * `IncomingMessage` to `AuthRequest` and writing the `AuthResponse` back
 * to `ServerResponse`. A small `nodeAdapter` helper at the bottom of this
 * file does exactly that.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import {
	extractSessionCookie,
	type IdentityProvider,
	type MagicLinkProvider,
	SESSION_COOKIE_NAME,
} from "./identity-provider.js";
import type { User } from "./identity-types.js";

const REQUEST_BODY_LIMIT_BYTES = 4096;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS_PER_WINDOW = 10;

const requestMagicLinkSchema = z.object({
	email: z.string().email().max(254),
});

export interface AuthRequest {
	method: string;
	pathname: string;
	cookieHeader: string | null | undefined;
	userAgent: string | null | undefined;
	remoteIp: string;
	/** When the request has a JSON body, the parsed body. Empty string is fine for GETs. */
	body: string;
}

export interface AuthResponse {
	status: number;
	headers: Record<string, string | string[]>;
	body: string;
}

export interface AuthRouterDependencies {
	provider: IdentityProvider;
	/** TLS-aware secure-cookie flag. The runtime server already tracks this. */
	useSecureCookie: boolean;
	/** Optional session TTL (mirrored into Max-Age). Defaults to 30 days. */
	sessionTtlMs?: number;
	/** Override clock for tests. */
	now?: () => number;
}

interface RateLimitEntry {
	windowStart: number;
	count: number;
}

const SESSION_TTL_MS_DEFAULT = 30 * 24 * 60 * 60 * 1000;

/**
 * Decide whether a given path looks like one of the auth endpoints. The
 * runtime server uses this to dispatch into the auth router before
 * falling through to its other handlers. Accepts a pathname optionally
 * suffixed with a query string.
 */
export function isAuthRoute(pathname: string): boolean {
	const justPath = pathname.split("?", 1)[0] ?? pathname;
	return (
		justPath === "/api/auth/me" ||
		justPath === "/api/auth/request-magic-link" ||
		justPath === "/api/auth/verify" ||
		justPath === "/api/auth/logout"
	);
}

function pathnameOnly(pathname: string): string {
	return pathname.split("?", 1)[0] ?? pathname;
}

/**
 * Per-IP token bucket. Auth endpoints are typed in by humans on real
 * networks; 10 requests / minute / IP is generous and still bounds spam.
 */
export class AuthRateLimiter {
	private readonly entries = new Map<string, RateLimitEntry>();

	constructor(
		private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
		private readonly maxPerWindow: number = RATE_LIMIT_MAX_REQUESTS_PER_WINDOW,
		private readonly clock: () => number = Date.now,
	) {}

	check(ip: string): { allowed: boolean; retryAfterSec: number } {
		const now = this.clock();
		const entry = this.entries.get(ip);
		if (!entry || now - entry.windowStart >= this.windowMs) {
			this.entries.set(ip, { windowStart: now, count: 1 });
			return { allowed: true, retryAfterSec: 0 };
		}
		if (entry.count >= this.maxPerWindow) {
			const retryAfterSec = Math.max(1, Math.ceil((entry.windowStart + this.windowMs - now) / 1000));
			return { allowed: false, retryAfterSec };
		}
		entry.count += 1;
		return { allowed: true, retryAfterSec: 0 };
	}
}

export interface AuthRouter {
	/**
	 * Route a single `AuthRequest` and return a structured `AuthResponse`.
	 * Returns `null` when the path isn't an auth route — the caller can
	 * dispatch to the next handler.
	 */
	handle(request: AuthRequest): Promise<AuthResponse | null>;
}

/**
 * Build a router for the given dependencies. The router is stateful for
 * its rate limiter; create one per server instance.
 */
export function createAuthRouter(deps: AuthRouterDependencies): AuthRouter {
	const rateLimiter = new AuthRateLimiter(undefined, undefined, deps.now);
	const sessionTtlMs = deps.sessionTtlMs ?? SESSION_TTL_MS_DEFAULT;

	return {
		async handle(request: AuthRequest): Promise<AuthResponse | null> {
			if (!isAuthRoute(request.pathname)) return null;
			const path = pathnameOnly(request.pathname);

			if (path === "/api/auth/me") {
				if (request.method !== "GET") return methodNotAllowed("GET");
				return await handleMe(deps.provider, request);
			}

			if (path === "/api/auth/logout") {
				if (request.method !== "POST") return methodNotAllowed("POST");
				return await handleLogout(deps.provider, request, deps.useSecureCookie);
			}

			if (path === "/api/auth/request-magic-link") {
				if (request.method !== "POST") return methodNotAllowed("POST");
				const rate = rateLimiter.check(request.remoteIp);
				if (!rate.allowed) return rateLimited(rate.retryAfterSec);
				return await handleRequestMagicLink(deps.provider, request);
			}

			if (path === "/api/auth/verify") {
				if (request.method !== "GET") return methodNotAllowed("GET");
				const rate = rateLimiter.check(request.remoteIp);
				if (!rate.allowed) return rateLimited(rate.retryAfterSec);
				return await handleVerify(deps.provider, request, deps.useSecureCookie, sessionTtlMs);
			}

			return notFound();
		},
	};
}

// ---------------------------------------------------------------------------
// Individual handlers
// ---------------------------------------------------------------------------

async function handleMe(provider: IdentityProvider, request: AuthRequest): Promise<AuthResponse> {
	const user = await provider.resolveFromCookie(request.cookieHeader);
	if (!user) {
		return jsonResponse(401, {
			authenticated: false,
			requiresLogin: provider.requiresLogin(),
		});
	}
	return jsonResponse(200, {
		authenticated: true,
		requiresLogin: provider.requiresLogin(),
		user: publicUserShape(user),
	});
}

async function handleLogout(
	provider: IdentityProvider,
	request: AuthRequest,
	useSecureCookie: boolean,
): Promise<AuthResponse> {
	if (provider.kind === "magic-link") {
		await (provider as MagicLinkProvider).logout(request.cookieHeader);
	}
	return {
		status: 200,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"Set-Cookie": expireCookie(useSecureCookie),
		},
		body: JSON.stringify({ ok: true }),
	};
}

async function handleRequestMagicLink(provider: IdentityProvider, request: AuthRequest): Promise<AuthResponse> {
	if (provider.kind !== "magic-link") {
		// Single-user mode doesn't issue magic links; tell the client clearly.
		return jsonResponse(400, { ok: false, error: "Magic-link login is not enabled on this server." });
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(request.body || "{}");
	} catch {
		return jsonResponse(400, { ok: false, error: "Invalid JSON." });
	}
	const result = requestMagicLinkSchema.safeParse(parsed);
	if (!result.success) {
		// Don't leak which field failed — keep the response opaque to resist enumeration.
		return jsonResponse(400, { ok: false, error: "email is required." });
	}
	await (provider as MagicLinkProvider).requestMagicLink({ email: result.data.email });
	// Always-OK shape; server-side details (whether the email exists, whether
	// the mailer succeeded) are not leaked to the client.
	return jsonResponse(200, { ok: true });
}

async function handleVerify(
	provider: IdentityProvider,
	request: AuthRequest,
	useSecureCookie: boolean,
	sessionTtlMs: number,
): Promise<AuthResponse> {
	if (provider.kind !== "magic-link") {
		return jsonResponse(400, { ok: false, error: "Magic-link login is not enabled on this server." });
	}
	const queryString = extractQueryString(request.pathname);
	const params = new URLSearchParams(queryString);
	const token = params.get("token") ?? "";
	if (!token) {
		return jsonResponse(400, { ok: false, error: "Missing token." });
	}
	const verify = await (provider as MagicLinkProvider).verifyMagicLink({
		token,
		userAgent: request.userAgent ?? null,
	});
	if (!verify.ok || !verify.session || !verify.user) {
		return jsonResponse(401, { ok: false, error: verify.reason ?? "verification failed." });
	}
	const cookie = sessionCookie({
		sessionId: verify.session.id,
		ttlMs: sessionTtlMs,
		secure: useSecureCookie,
	});
	return {
		status: 200,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"Set-Cookie": cookie,
		},
		body: JSON.stringify({ ok: true, user: publicUserShape(verify.user) }),
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function publicUserShape(user: User): {
	id: string;
	email: string;
	displayName: string | null;
	role: User["role"];
} {
	return {
		id: user.id,
		email: user.email,
		displayName: user.displayName,
		role: user.role,
	};
}

function jsonResponse(status: number, body: Record<string, unknown>): AuthResponse {
	return {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(body),
	};
}

function methodNotAllowed(allowed: string): AuthResponse {
	return {
		status: 405,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			Allow: allowed,
		},
		body: JSON.stringify({ ok: false, error: "Method not allowed." }),
	};
}

function notFound(): AuthResponse {
	return jsonResponse(404, { ok: false, error: "Not found." });
}

function rateLimited(retryAfterSec: number): AuthResponse {
	return {
		status: 429,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"Retry-After": String(retryAfterSec),
		},
		body: JSON.stringify({ ok: false, error: "Too many requests. Please wait before retrying." }),
	};
}

function sessionCookie(input: { sessionId: string; ttlMs: number; secure: boolean }): string {
	const flags = [
		`${SESSION_COOKIE_NAME}=${encodeURIComponent(input.sessionId)}`,
		"HttpOnly",
		"SameSite=Strict",
		"Path=/",
		`Max-Age=${Math.max(0, Math.floor(input.ttlMs / 1000))}`,
	];
	if (input.secure) flags.push("Secure");
	return flags.join("; ");
}

function expireCookie(secure: boolean): string {
	const flags = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
	if (secure) flags.push("Secure");
	return flags.join("; ");
}

function extractQueryString(pathnameWithMaybeQuery: string): string {
	const queryIndex = pathnameWithMaybeQuery.indexOf("?");
	if (queryIndex >= 0) return pathnameWithMaybeQuery.slice(queryIndex + 1);
	return "";
}

// ---------------------------------------------------------------------------
// Node http adapter — the runtime server uses this to glue routes in.
// ---------------------------------------------------------------------------

/** Read up to `maxBytes` of UTF-8 body from a Node request. */
export async function readRequestBody(req: IncomingMessage, maxBytes = REQUEST_BODY_LIMIT_BYTES): Promise<string> {
	return await new Promise((resolveBody, rejectBody) => {
		let total = 0;
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > maxBytes) {
				req.destroy();
				rejectBody(new Error("Request body too large."));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolveBody(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", rejectBody);
	});
}

/**
 * Translate a Node IncomingMessage / ServerResponse pair into our
 * abstract Auth* types and back. Returns `true` when an auth response
 * was written; `false` when the path isn't an auth route and the caller
 * should keep dispatching.
 */
export async function dispatchAuthOnNode(
	router: AuthRouter,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const pathname = url.pathname;
	if (!isAuthRoute(pathname)) return false;

	let body = "";
	if (req.method && req.method !== "GET") {
		try {
			body = await readRequestBody(req);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
			res.end(JSON.stringify({ ok: false, error: "Invalid request body." }));
			return true;
		}
	}

	// For GET /verify we want the query string to flow through.
	const pathnameWithQuery = url.search ? `${pathname}${url.search}` : pathname;

	const response = await router.handle({
		method: req.method ?? "GET",
		pathname: pathnameWithQuery,
		cookieHeader: req.headers.cookie ?? null,
		userAgent: extractHeader(req.headers["user-agent"]),
		remoteIp: req.socket.remoteAddress ?? "unknown",
		body,
	});
	if (!response) return false;
	res.writeHead(response.status, response.headers);
	res.end(response.body);
	return true;
}

function extractHeader(value: string | string[] | undefined): string | null {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value[0] ?? null;
	return null;
}

/** Re-export so call sites don't need to import from identity-provider directly. */
export { extractSessionCookie, SESSION_COOKIE_NAME };
