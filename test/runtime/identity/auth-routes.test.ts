import { describe, expect, it } from "vitest";

import { AuthRateLimiter, type AuthRequest, createAuthRouter, isAuthRoute } from "../../../src/identity/auth-routes";
import {
	LocalSingleUserProvider,
	MagicLinkProvider,
	SESSION_COOKIE_NAME,
} from "../../../src/identity/identity-provider";
import {
	InMemoryMagicLinkTokenStore,
	InMemorySessionStore,
	InMemoryUserStore,
} from "../../../src/identity/in-memory-identity-store";
import { NoopMailer } from "../../../src/identity/mailer";

function makeMagicLinkSetup() {
	const users = new InMemoryUserStore();
	const sessions = new InMemorySessionStore();
	const tokens = new InMemoryMagicLinkTokenStore();
	const mailer = new NoopMailer();
	const provider = new MagicLinkProvider({
		users,
		sessions,
		tokens,
		mailer,
		publicBaseUrl: "https://kanban.test",
	});
	const router = createAuthRouter({ provider, useSecureCookie: true });
	return { provider, router, users, sessions, tokens, mailer };
}

function baseRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
	return {
		method: "GET",
		pathname: "/api/auth/me",
		cookieHeader: null,
		userAgent: "vitest",
		remoteIp: "127.0.0.1",
		body: "",
		...overrides,
	};
}

describe("isAuthRoute", () => {
	it("matches the four auth endpoints and rejects other paths", () => {
		expect(isAuthRoute("/api/auth/me")).toBe(true);
		expect(isAuthRoute("/api/auth/request-magic-link")).toBe(true);
		expect(isAuthRoute("/api/auth/verify")).toBe(true);
		expect(isAuthRoute("/api/auth/logout")).toBe(true);
		expect(isAuthRoute("/api/trpc")).toBe(false);
		expect(isAuthRoute("/")).toBe(false);
	});
});

describe("auth router — /api/auth/me", () => {
	it("returns the local user under LocalSingleUserProvider", async () => {
		const provider = new LocalSingleUserProvider();
		const router = createAuthRouter({ provider, useSecureCookie: false });
		const response = await router.handle(baseRequest());
		expect(response?.status).toBe(200);
		const payload = JSON.parse(response?.body ?? "{}");
		expect(payload.authenticated).toBe(true);
		expect(payload.requiresLogin).toBe(false);
		expect(payload.user.email).toBe("local@kanban");
	});

	it("returns 401 when unauthenticated under MagicLinkProvider", async () => {
		const { router } = makeMagicLinkSetup();
		const response = await router.handle(baseRequest({ pathname: "/api/auth/me" }));
		expect(response?.status).toBe(401);
		const payload = JSON.parse(response?.body ?? "{}");
		expect(payload.authenticated).toBe(false);
		expect(payload.requiresLogin).toBe(true);
	});

	it("rejects non-GET methods on /me with 405", async () => {
		const { router } = makeMagicLinkSetup();
		const response = await router.handle(baseRequest({ method: "POST" }));
		expect(response?.status).toBe(405);
		expect(response?.headers.Allow).toBe("GET");
	});
});

describe("auth router — /api/auth/request-magic-link", () => {
	it("returns 200 + ok:true for a valid email and emails the user", async () => {
		const { router, mailer } = makeMagicLinkSetup();
		const response = await router.handle(
			baseRequest({
				method: "POST",
				pathname: "/api/auth/request-magic-link",
				body: JSON.stringify({ email: "alice@example.com" }),
			}),
		);
		expect(response?.status).toBe(200);
		const payload = JSON.parse(response?.body ?? "{}");
		expect(payload.ok).toBe(true);
		expect(mailer.outbox).toHaveLength(1);
	});

	it("returns 400 on malformed JSON body", async () => {
		const { router } = makeMagicLinkSetup();
		const response = await router.handle(
			baseRequest({ method: "POST", pathname: "/api/auth/request-magic-link", body: "{not json" }),
		);
		expect(response?.status).toBe(400);
	});

	it("returns 400 on missing email", async () => {
		const { router } = makeMagicLinkSetup();
		const response = await router.handle(
			baseRequest({ method: "POST", pathname: "/api/auth/request-magic-link", body: JSON.stringify({}) }),
		);
		expect(response?.status).toBe(400);
	});

	it("returns 400 with single-user provider (magic link disabled)", async () => {
		const provider = new LocalSingleUserProvider();
		const router = createAuthRouter({ provider, useSecureCookie: false });
		const response = await router.handle(
			baseRequest({
				method: "POST",
				pathname: "/api/auth/request-magic-link",
				body: JSON.stringify({ email: "alice@example.com" }),
			}),
		);
		expect(response?.status).toBe(400);
	});
});

describe("auth router — /api/auth/verify", () => {
	it("issues a session cookie on a valid token", async () => {
		const { provider, router } = makeMagicLinkSetup();
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		const response = await router.handle(
			baseRequest({
				method: "GET",
				pathname: `/api/auth/verify?token=${encodeURIComponent(token)}`,
			}),
		);
		expect(response?.status).toBe(200);
		const setCookie = String(response?.headers["Set-Cookie"]);
		expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Strict");
		expect(setCookie).toContain("Secure");
	});

	it("returns 401 on a bogus token", async () => {
		const { router } = makeMagicLinkSetup();
		const response = await router.handle(baseRequest({ method: "GET", pathname: "/api/auth/verify?token=bogus" }));
		expect(response?.status).toBe(401);
	});

	it("returns 400 when token is absent", async () => {
		const { router } = makeMagicLinkSetup();
		const response = await router.handle(baseRequest({ method: "GET", pathname: "/api/auth/verify" }));
		expect(response?.status).toBe(400);
	});
});

describe("auth router — /api/auth/logout", () => {
	it("clears the session cookie", async () => {
		const { provider, router } = makeMagicLinkSetup();
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		const verify = await provider.verifyMagicLink({ token });
		const cookie = `${SESSION_COOKIE_NAME}=${verify.session?.id}`;
		const response = await router.handle(
			baseRequest({ method: "POST", pathname: "/api/auth/logout", cookieHeader: cookie }),
		);
		expect(response?.status).toBe(200);
		const setCookie = String(response?.headers["Set-Cookie"]);
		expect(setCookie).toContain("Max-Age=0");
		// And the underlying session is gone.
		expect(await provider.resolveFromCookie(cookie)).toBeNull();
	});
});

describe("auth router — rate limiting", () => {
	it("returns 429 once the window is full", async () => {
		const { router } = makeMagicLinkSetup();
		// Default: 10 requests per IP per minute. Issue 10, then expect 429.
		for (let i = 0; i < 10; i++) {
			const response = await router.handle(
				baseRequest({
					method: "POST",
					pathname: "/api/auth/request-magic-link",
					body: JSON.stringify({ email: `alice+${i}@example.com` }),
				}),
			);
			expect(response?.status).toBe(200);
		}
		const blocked = await router.handle(
			baseRequest({
				method: "POST",
				pathname: "/api/auth/request-magic-link",
				body: JSON.stringify({ email: "spam@example.com" }),
			}),
		);
		expect(blocked?.status).toBe(429);
		expect(blocked?.headers["Retry-After"]).toBeTruthy();
	});

	it("does not rate-limit /api/auth/me (read-only)", async () => {
		const { router } = makeMagicLinkSetup();
		for (let i = 0; i < 30; i++) {
			const response = await router.handle(baseRequest({ method: "GET", pathname: "/api/auth/me" }));
			expect(response?.status).toBe(401); // unauthenticated, but not rate-limited
		}
	});
});

describe("AuthRateLimiter", () => {
	it("counts requests per IP within the window", () => {
		const now = 0;
		const limiter = new AuthRateLimiter(1000, 3, () => now);
		expect(limiter.check("a").allowed).toBe(true);
		expect(limiter.check("a").allowed).toBe(true);
		expect(limiter.check("a").allowed).toBe(true);
		expect(limiter.check("a").allowed).toBe(false);
		// Different IP, fresh budget
		expect(limiter.check("b").allowed).toBe(true);
	});

	it("resets after the window passes", () => {
		let now = 0;
		const limiter = new AuthRateLimiter(1000, 1, () => now);
		expect(limiter.check("a").allowed).toBe(true);
		expect(limiter.check("a").allowed).toBe(false);
		now += 1001;
		expect(limiter.check("a").allowed).toBe(true);
	});

	it("emits a sane Retry-After hint", () => {
		const now = 0;
		const limiter = new AuthRateLimiter(10_000, 1, () => now);
		expect(limiter.check("a").allowed).toBe(true);
		const blocked = limiter.check("a");
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
		expect(blocked.retryAfterSec).toBeLessThanOrEqual(10);
	});
});
