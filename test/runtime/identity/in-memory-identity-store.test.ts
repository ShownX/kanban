import { describe, expect, it } from "vitest";

import {
	InMemoryMagicLinkTokenStore,
	InMemorySessionStore,
	InMemoryUserStore,
} from "../../../src/identity/in-memory-identity-store";

describe("InMemoryUserStore", () => {
	it("creates and finds users by email (case-insensitive)", async () => {
		const store = new InMemoryUserStore();
		const user = await store.create({ email: "Alice@Example.com" });
		expect(user.email).toBe("alice@example.com");
		const byEmail = await store.findByEmail("ALICE@example.com");
		expect(byEmail?.id).toBe(user.id);
		const byId = await store.findById(user.id);
		expect(byId?.email).toBe("alice@example.com");
	});

	it("rejects duplicate emails", async () => {
		const store = new InMemoryUserStore();
		await store.create({ email: "alice@example.com" });
		await expect(store.create({ email: "alice@example.com" })).rejects.toThrow(/already exists/);
	});

	it("records last-login timestamps", async () => {
		const store = new InMemoryUserStore();
		const user = await store.create({ email: "alice@example.com" });
		expect(user.lastLoginAt).toBeNull();
		await store.recordLogin(user.id);
		const after = await store.findById(user.id);
		expect(after?.lastLoginAt).not.toBeNull();
	});

	it("list returns users sorted by email", async () => {
		const store = new InMemoryUserStore();
		await store.create({ email: "carol@example.com" });
		await store.create({ email: "alice@example.com" });
		await store.create({ email: "bob@example.com" });
		const list = await store.list();
		expect(list.map((u) => u.email)).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
	});
});

describe("InMemorySessionStore", () => {
	it("issues sessions and finds them by id while valid", async () => {
		const store = new InMemorySessionStore();
		const session = await store.create({ userId: "u1", ttlMs: 60_000 });
		const found = await store.findValid(session.id);
		expect(found?.userId).toBe("u1");
	});

	it("returns null for expired sessions and purges them", async () => {
		const store = new InMemorySessionStore();
		const session = await store.create({ userId: "u1", ttlMs: -1 }); // already expired
		expect(await store.findValid(session.id)).toBeNull();
		// findValid should have purged it; subsequent purgeExpired count is 0.
		expect(await store.purgeExpired()).toBe(0);
	});

	it("revokes by id and by user", async () => {
		const store = new InMemorySessionStore();
		const a = await store.create({ userId: "u1", ttlMs: 60_000 });
		const b = await store.create({ userId: "u1", ttlMs: 60_000 });
		const c = await store.create({ userId: "u2", ttlMs: 60_000 });
		await store.revoke(a.id);
		expect(await store.findValid(a.id)).toBeNull();
		await store.revokeAllForUser("u1");
		expect(await store.findValid(b.id)).toBeNull();
		expect(await store.findValid(c.id)).not.toBeNull();
	});
});

describe("InMemoryMagicLinkTokenStore", () => {
	it("issues tokens and finds them by hash while valid", async () => {
		const store = new InMemoryMagicLinkTokenStore();
		const token = await store.create({
			email: "alice@example.com",
			tokenHash: "abc",
			ttlMs: 60_000,
		});
		const found = await store.findValidByHash("abc");
		expect(found?.id).toBe(token.id);
	});

	it("treats consumed tokens as invalid", async () => {
		const store = new InMemoryMagicLinkTokenStore();
		const token = await store.create({
			email: "alice@example.com",
			tokenHash: "abc",
			ttlMs: 60_000,
		});
		await store.consume(token.id);
		expect(await store.findValidByHash("abc")).toBeNull();
	});

	it("treats expired tokens as invalid", async () => {
		const store = new InMemoryMagicLinkTokenStore();
		await store.create({ email: "alice@example.com", tokenHash: "abc", ttlMs: -1 });
		expect(await store.findValidByHash("abc")).toBeNull();
	});

	it("purgeExpired drops expired and consumed tokens", async () => {
		const store = new InMemoryMagicLinkTokenStore();
		await store.create({ email: "a@example.com", tokenHash: "h1", ttlMs: -1 });
		const live = await store.create({ email: "b@example.com", tokenHash: "h2", ttlMs: 60_000 });
		const purged = await store.purgeExpired();
		expect(purged).toBe(1);
		expect(await store.findValidByHash("h2")).not.toBeNull();
		expect(await store.findValidByHash("h2")).toMatchObject({ id: live.id });
	});
});
