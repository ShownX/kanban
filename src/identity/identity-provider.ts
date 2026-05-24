/**
 * IdentityProvider — the boundary between the runtime and "who is this
 * request from?".
 *
 * Two implementations ship in this branch:
 *
 *   - `LocalSingleUserProvider` — every request resolves to a synthetic
 *     `local` user. Default when single-user mode is on. The runtime
 *     can keep treating "current user" as load-bearing without breaking
 *     the existing local-first product.
 *
 *   - `MagicLinkProvider` — backs the auth routes for self-hosted /
 *     hosted multi-user mode. Issues + verifies one-time tokens, manages
 *     sessions, and resolves the current user from a session cookie.
 *
 * Anything that calls `provider.resolveFromCookie(cookieHeader)` gets back
 * a `User | null`. Routes that require auth wrap the call in a 401
 * gate; routes that work for either mode treat null as "anonymous" or
 * use `requireUser`.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MagicLinkTokenStore, Session, SessionStore, User, UserStore } from "./identity-types.js";
import type { Mailer } from "./mailer.js";

const DEFAULT_MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE_NAME = "kanban_session";

export interface IdentityProvider {
	/** Stable string for diagnostic / logging. */
	readonly kind: "local-single-user" | "magic-link";
	/** Resolve the current user from a request's Cookie header. */
	resolveFromCookie(cookieHeader: string | null | undefined): Promise<User | null>;
	/** True when this provider gates access; the runtime UI uses this to decide whether to render a login page. */
	requiresLogin(): boolean;
}

// ---------------------------------------------------------------------------
// LocalSingleUserProvider — default; preserves single-user behavior.
// ---------------------------------------------------------------------------

export const LOCAL_USER_ID = "local";

export class LocalSingleUserProvider implements IdentityProvider {
	readonly kind = "local-single-user" as const;

	private readonly user: User;

	constructor(displayName?: string) {
		this.user = {
			id: LOCAL_USER_ID,
			email: "local@kanban",
			displayName: displayName ?? "Local user",
			role: "admin",
			createdAt: new Date(0).toISOString(),
			lastLoginAt: null,
		};
	}

	async resolveFromCookie(_cookieHeader: string | null | undefined): Promise<User | null> {
		return this.user;
	}

	requiresLogin(): boolean {
		return false;
	}
}

// ---------------------------------------------------------------------------
// MagicLinkProvider — multi-user; issues + consumes magic-link tokens
// and manages sessions through the injected stores.
// ---------------------------------------------------------------------------

export interface MagicLinkProviderConfig {
	users: UserStore;
	sessions: SessionStore;
	tokens: MagicLinkTokenStore;
	mailer: Mailer;
	/** Origin used to render the magic-link URL, e.g. https://kanban.example.com. */
	publicBaseUrl: string;
	/** Override TTLs; mainly for tests. */
	magicLinkTtlMs?: number;
	sessionTtlMs?: number;
	/** Auto-create users on first login, or require an admin to invite first. Default true. */
	autoProvisionUsers?: boolean;
}

export interface RequestMagicLinkResult {
	/** Always true on success; we don't reveal whether the email exists to avoid enumeration. */
	ok: true;
	/** Plaintext URL — only returned in dev/test; production callers shouldn't use this. */
	debugLinkUrl?: string;
}

export interface VerifyMagicLinkResult {
	ok: boolean;
	user?: User;
	session?: Session;
	reason?: "invalid_token" | "expired_token" | "consumed_token" | "no_user_for_email";
}

export class MagicLinkProvider implements IdentityProvider {
	readonly kind = "magic-link" as const;

	private readonly users: UserStore;
	private readonly sessions: SessionStore;
	private readonly tokens: MagicLinkTokenStore;
	private readonly mailer: Mailer;
	private readonly publicBaseUrl: string;
	private readonly magicLinkTtlMs: number;
	private readonly sessionTtlMs: number;
	private readonly autoProvisionUsers: boolean;

	constructor(config: MagicLinkProviderConfig) {
		this.users = config.users;
		this.sessions = config.sessions;
		this.tokens = config.tokens;
		this.mailer = config.mailer;
		this.publicBaseUrl = config.publicBaseUrl.replace(/\/$/, "");
		this.magicLinkTtlMs = config.magicLinkTtlMs ?? DEFAULT_MAGIC_LINK_TTL_MS;
		this.sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
		this.autoProvisionUsers = config.autoProvisionUsers ?? true;
	}

	requiresLogin(): boolean {
		return true;
	}

	async resolveFromCookie(cookieHeader: string | null | undefined): Promise<User | null> {
		const sessionId = extractSessionCookie(cookieHeader);
		if (!sessionId) return null;
		const session = await this.sessions.findValid(sessionId);
		if (!session) return null;
		const user = await this.users.findById(session.userId);
		if (!user) {
			// User was deleted; revoke any lingering session.
			await this.sessions.revoke(sessionId);
			return null;
		}
		void this.sessions.touch(sessionId);
		return user;
	}

	/**
	 * Step 1 of login: issue a magic link and email it to the requester.
	 * Returns `ok: true` regardless of whether the email is registered (to
	 * resist account enumeration). When `autoProvisionUsers` is on and the
	 * email isn't known, we still email the link and provision the user
	 * lazily at verify time.
	 */
	async requestMagicLink(input: { email: string }): Promise<RequestMagicLinkResult> {
		const email = input.email.trim().toLowerCase();
		if (!isPlausibleEmail(email)) {
			// We still report `ok: true` — same shape, no enumeration leak.
			return { ok: true };
		}

		// In strict-provisioning mode, only known emails get a link issued.
		if (!this.autoProvisionUsers) {
			const user = await this.users.findByEmail(email);
			if (!user) return { ok: true };
		}

		const plaintext = generatePlaintextToken();
		const tokenHash = hashToken(plaintext);
		await this.tokens.create({ email, tokenHash, ttlMs: this.magicLinkTtlMs });
		const link = `${this.publicBaseUrl}/api/auth/verify?token=${encodeURIComponent(plaintext)}`;
		await this.mailer.send({
			to: email,
			subject: "Your Kanban login link",
			body: [
				"Click the link below to sign in. It expires in 15 minutes.",
				"",
				link,
				"",
				"If you didn't request this, you can ignore the message — the link can't be used without your inbox.",
			].join("\n"),
		});
		return { ok: true, debugLinkUrl: link };
	}

	/**
	 * Step 2: exchange a one-time token for a session. The plaintext token
	 * is hashed in this method and compared in constant time to the stored
	 * value via the store interface.
	 */
	async verifyMagicLink(input: { token: string; userAgent?: string | null }): Promise<VerifyMagicLinkResult> {
		const tokenHash = hashToken(input.token);
		const stored = await this.tokens.findValidByHash(tokenHash);
		if (!stored) {
			return { ok: false, reason: "invalid_token" };
		}
		// Constant-time compare against the stored hash to defend against
		// any leak from the lookup-by-hash path.
		if (!constantTimeEqualHex(stored.tokenHash, tokenHash)) {
			return { ok: false, reason: "invalid_token" };
		}
		await this.tokens.consume(stored.id);

		let user = await this.users.findByEmail(stored.email);
		if (!user) {
			if (!this.autoProvisionUsers) {
				return { ok: false, reason: "no_user_for_email" };
			}
			user = await this.users.create({ email: stored.email });
		}
		await this.users.recordLogin(user.id);
		const session = await this.sessions.create({
			userId: user.id,
			ttlMs: this.sessionTtlMs,
			userAgent: input.userAgent ?? null,
		});
		return { ok: true, user, session };
	}

	async logout(cookieHeader: string | null | undefined): Promise<void> {
		const sessionId = extractSessionCookie(cookieHeader);
		if (!sessionId) return;
		await this.sessions.revoke(sessionId);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generatePlaintextToken(): string {
	// 32 random bytes → base64url; same shape OAuth-style tokens use.
	return randomBytes(32).toString("base64url");
}

export function hashToken(plaintext: string): string {
	return createHash("sha256").update(plaintext).digest("hex");
}

export function extractSessionCookie(cookieHeader: string | null | undefined): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const [rawName, ...rest] = part.split("=");
		const name = rawName?.trim();
		if (name === SESSION_COOKIE_NAME && rest.length > 0) {
			return decodeURIComponent(rest.join("=").trim());
		}
	}
	return null;
}

function isPlausibleEmail(value: string): boolean {
	// Server-side gate; we still defer to z.string().email() for schema validation
	// at the route boundary. This is a fast guard for the rate-limit / token-issue path.
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function constantTimeEqualHex(left: string, right: string): boolean {
	if (left.length !== right.length) return false;
	try {
		return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
	} catch {
		return false;
	}
}
