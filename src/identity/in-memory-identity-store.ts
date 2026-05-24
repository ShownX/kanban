/**
 * In-memory identity store. Used in unit tests and for ephemeral hosts.
 *
 * Data lives entirely in this process's memory; nothing persists across
 * restarts. The implementation is intentionally simple — no concurrency
 * primitives — because tests run single-threaded and the on-disk impl
 * exists for the multi-process case.
 */

import { randomUUID } from "node:crypto";

import type {
	MagicLinkToken,
	MagicLinkTokenStore,
	Session,
	SessionStore,
	User,
	UserRole,
	UserStore,
} from "./identity-types.js";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export class InMemoryUserStore implements UserStore {
	private readonly byId = new Map<string, User>();

	async findByEmail(email: string): Promise<User | null> {
		const normalized = email.trim().toLowerCase();
		for (const user of this.byId.values()) {
			if (user.email.toLowerCase() === normalized) return user;
		}
		return null;
	}

	async findById(id: string): Promise<User | null> {
		return this.byId.get(id) ?? null;
	}

	async create(input: { email: string; displayName?: string | null; role?: UserRole }): Promise<User> {
		const normalizedEmail = input.email.trim().toLowerCase();
		if (await this.findByEmail(normalizedEmail)) {
			throw new Error(`User with email "${normalizedEmail}" already exists.`);
		}
		const user: User = {
			id: randomUUID(),
			email: normalizedEmail,
			displayName: input.displayName ?? null,
			role: input.role ?? "member",
			createdAt: new Date().toISOString(),
			lastLoginAt: null,
		};
		this.byId.set(user.id, user);
		return user;
	}

	async recordLogin(userId: string): Promise<void> {
		const user = this.byId.get(userId);
		if (!user) return;
		this.byId.set(userId, { ...user, lastLoginAt: new Date().toISOString() });
	}

	async list(): Promise<User[]> {
		return Array.from(this.byId.values()).sort((a, b) => a.email.localeCompare(b.email));
	}
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export class InMemorySessionStore implements SessionStore {
	private readonly byId = new Map<string, Session>();

	async create(input: { userId: string; ttlMs: number; userAgent?: string | null }): Promise<Session> {
		const issuedAt = new Date();
		const session: Session = {
			id: randomUUID(),
			userId: input.userId,
			issuedAt: issuedAt.toISOString(),
			expiresAt: new Date(issuedAt.getTime() + input.ttlMs).toISOString(),
			lastUsedAt: issuedAt.toISOString(),
			userAgent: input.userAgent ?? null,
		};
		this.byId.set(session.id, session);
		return session;
	}

	async findValid(id: string): Promise<Session | null> {
		const session = this.byId.get(id);
		if (!session) return null;
		if (Date.parse(session.expiresAt) <= Date.now()) {
			this.byId.delete(id);
			return null;
		}
		return session;
	}

	async touch(id: string): Promise<void> {
		const session = this.byId.get(id);
		if (!session) return;
		this.byId.set(id, { ...session, lastUsedAt: new Date().toISOString() });
	}

	async revoke(id: string): Promise<void> {
		this.byId.delete(id);
	}

	async revokeAllForUser(userId: string): Promise<void> {
		for (const [id, session] of this.byId) {
			if (session.userId === userId) this.byId.delete(id);
		}
	}

	async purgeExpired(): Promise<number> {
		const now = Date.now();
		let purged = 0;
		for (const [id, session] of this.byId) {
			if (Date.parse(session.expiresAt) <= now) {
				this.byId.delete(id);
				purged += 1;
			}
		}
		return purged;
	}
}

// ---------------------------------------------------------------------------
// Magic-link tokens
// ---------------------------------------------------------------------------

export class InMemoryMagicLinkTokenStore implements MagicLinkTokenStore {
	private readonly byId = new Map<string, MagicLinkToken>();
	private readonly idByHash = new Map<string, string>();

	async create(input: { email: string; tokenHash: string; ttlMs: number }): Promise<MagicLinkToken> {
		const issuedAt = new Date();
		const token: MagicLinkToken = {
			id: randomUUID(),
			email: input.email.trim().toLowerCase(),
			tokenHash: input.tokenHash,
			issuedAt: issuedAt.toISOString(),
			expiresAt: new Date(issuedAt.getTime() + input.ttlMs).toISOString(),
			consumedAt: null,
		};
		this.byId.set(token.id, token);
		this.idByHash.set(token.tokenHash, token.id);
		return token;
	}

	async findValidByHash(tokenHash: string): Promise<MagicLinkToken | null> {
		const id = this.idByHash.get(tokenHash);
		if (!id) return null;
		const token = this.byId.get(id);
		if (!token) return null;
		if (token.consumedAt) return null;
		if (Date.parse(token.expiresAt) <= Date.now()) return null;
		return token;
	}

	async consume(id: string): Promise<void> {
		const token = this.byId.get(id);
		if (!token) return;
		this.byId.set(id, { ...token, consumedAt: new Date().toISOString() });
	}

	async purgeExpired(): Promise<number> {
		const now = Date.now();
		let purged = 0;
		for (const [id, token] of this.byId) {
			const expired = Date.parse(token.expiresAt) <= now;
			if (expired || token.consumedAt) {
				this.byId.delete(id);
				this.idByHash.delete(token.tokenHash);
				purged += 1;
			}
		}
		return purged;
	}
}
