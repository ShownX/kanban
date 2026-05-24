import { describe, expect, it } from "vitest";
import {
	extractSessionCookie,
	hashToken,
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

function makeProvider(overrides: Partial<ConstructorParameters<typeof MagicLinkProvider>[0]> = {}): {
	provider: MagicLinkProvider;
	users: InMemoryUserStore;
	sessions: InMemorySessionStore;
	tokens: InMemoryMagicLinkTokenStore;
	mailer: NoopMailer;
} {
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
		...overrides,
	});
	return { provider, users, sessions, tokens, mailer };
}

describe("LocalSingleUserProvider", () => {
	it("resolves every cookie to the synthetic local user", async () => {
		const provider = new LocalSingleUserProvider();
		const user = await provider.resolveFromCookie(undefined);
		expect(user?.id).toBe("local");
		expect(provider.requiresLogin()).toBe(false);
	});
});

describe("MagicLinkProvider — request + verify happy path", () => {
	it("issues a token, emails the link, then verifies and creates a session", async () => {
		const { provider, users, sessions, mailer } = makeProvider();
		const result = await provider.requestMagicLink({ email: "alice@example.com" });
		expect(result.ok).toBe(true);
		expect(mailer.outbox).toHaveLength(1);
		const link = result.debugLinkUrl ?? "";
		expect(link).toContain("https://kanban.test/api/auth/verify?token=");

		const token = new URL(link).searchParams.get("token") ?? "";
		const verify = await provider.verifyMagicLink({ token, userAgent: "vitest" });
		expect(verify.ok).toBe(true);
		expect(verify.user?.email).toBe("alice@example.com");
		expect(verify.session?.userAgent).toBe("vitest");

		// User was auto-provisioned; lastLoginAt was stamped.
		const persisted = await users.findByEmail("alice@example.com");
		expect(persisted?.lastLoginAt).not.toBeNull();
		expect(await sessions.findValid(verify.session?.id ?? "")).not.toBeNull();
	});
});

describe("MagicLinkProvider — failure modes", () => {
	it("returns ok:true even for plainly invalid emails (no enumeration leak)", async () => {
		const { provider, mailer } = makeProvider();
		const result = await provider.requestMagicLink({ email: "not-an-email" });
		expect(result.ok).toBe(true);
		expect(mailer.outbox).toHaveLength(0);
	});

	it("returns ok:true but issues no link when autoProvisionUsers is off and the email is unknown", async () => {
		const { provider, tokens, mailer } = makeProvider({ autoProvisionUsers: false });
		const result = await provider.requestMagicLink({ email: "stranger@example.com" });
		expect(result.ok).toBe(true);
		expect(mailer.outbox).toHaveLength(0);
		// And no token was created
		expect(await tokens.findValidByHash("anything")).toBeNull();
	});

	it("rejects unknown tokens", async () => {
		const { provider } = makeProvider();
		const verify = await provider.verifyMagicLink({ token: "totally-bogus-token" });
		expect(verify.ok).toBe(false);
		expect(verify.reason).toBe("invalid_token");
	});

	it("rejects already-consumed tokens (single-use)", async () => {
		const { provider } = makeProvider();
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		const first = await provider.verifyMagicLink({ token });
		expect(first.ok).toBe(true);
		const second = await provider.verifyMagicLink({ token });
		expect(second.ok).toBe(false);
		expect(second.reason).toBe("invalid_token");
	});

	it("rejects expired tokens", async () => {
		const { provider } = makeProvider({ magicLinkTtlMs: -1 });
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		const verify = await provider.verifyMagicLink({ token });
		expect(verify.ok).toBe(false);
		expect(verify.reason).toBe("invalid_token");
	});

	it("refuses verify when autoProvisionUsers is off and the email has no user", async () => {
		const { provider, users } = makeProvider({ autoProvisionUsers: false });
		// Sneak a valid token onto the provider by going through requestMagicLink with a known email
		// then deleting the user. (Simulates a token that survived an admin removing the user.)
		await users.create({ email: "alice@example.com" });
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		// Forcibly drop the user via private state — fine for an in-memory test.
		const refresh = await users.findByEmail("alice@example.com");
		(users as unknown as { byId: Map<string, unknown> }).byId.delete(refresh?.id ?? "");
		const verify = await provider.verifyMagicLink({ token });
		expect(verify.ok).toBe(false);
		expect(verify.reason).toBe("no_user_for_email");
	});
});

describe("MagicLinkProvider — session resolution", () => {
	it("resolveFromCookie returns the user behind a valid session id", async () => {
		const { provider } = makeProvider();
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		const verify = await provider.verifyMagicLink({ token });
		const cookie = `${SESSION_COOKIE_NAME}=${verify.session?.id}; HttpOnly`;
		const user = await provider.resolveFromCookie(cookie);
		expect(user?.email).toBe("alice@example.com");
	});

	it("resolveFromCookie returns null for missing or invalid cookies", async () => {
		const { provider } = makeProvider();
		expect(await provider.resolveFromCookie(null)).toBeNull();
		expect(await provider.resolveFromCookie(undefined)).toBeNull();
		expect(await provider.resolveFromCookie("")).toBeNull();
		expect(await provider.resolveFromCookie("other=cookie")).toBeNull();
		expect(await provider.resolveFromCookie(`${SESSION_COOKIE_NAME}=bogus`)).toBeNull();
	});

	it("logout invalidates the session", async () => {
		const { provider } = makeProvider();
		const r = await provider.requestMagicLink({ email: "alice@example.com" });
		const token = new URL(r.debugLinkUrl ?? "").searchParams.get("token") ?? "";
		const verify = await provider.verifyMagicLink({ token });
		const cookie = `${SESSION_COOKIE_NAME}=${verify.session?.id}`;
		expect(await provider.resolveFromCookie(cookie)).not.toBeNull();
		await provider.logout(cookie);
		expect(await provider.resolveFromCookie(cookie)).toBeNull();
	});
});

describe("extractSessionCookie", () => {
	it("returns null on missing input", () => {
		expect(extractSessionCookie(null)).toBeNull();
		expect(extractSessionCookie(undefined)).toBeNull();
	});

	it("parses a single cookie", () => {
		expect(extractSessionCookie(`${SESSION_COOKIE_NAME}=abc`)).toBe("abc");
	});

	it("parses the right cookie out of a Cookie header with multiple entries", () => {
		const header = `theme=dark; ${SESSION_COOKIE_NAME}=def; lang=en`;
		expect(extractSessionCookie(header)).toBe("def");
	});
});

describe("hashToken", () => {
	it("returns 64 hex chars for any input", () => {
		expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is deterministic", () => {
		expect(hashToken("same")).toBe(hashToken("same"));
	});

	it("different inputs differ", () => {
		expect(hashToken("a")).not.toBe(hashToken("b"));
	});
});
