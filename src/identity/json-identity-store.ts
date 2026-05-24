/**
 * JSON-on-disk identity stores for self-hosted multi-user mode.
 *
 * Three small files under the host's identity directory:
 *   users.json
 *   sessions.json
 *   magic-link-tokens.json
 *
 * Each file holds a flat object keyed by id. Reads load the whole file; writes
 * go through `lockedFileSystem.writeJsonFileAtomic` so concurrent processes
 * (a kanban server + a CLI invocation) can't clobber each other. The caller
 * also serializes mutations by acquiring the same file lock for the
 * read-modify-write window.
 *
 * Sized for self-hosted teams (low hundreds of users / low thousands of
 * sessions). Past that we swap the implementations for a real database;
 * the doc covers when.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system.js";
import {
	type MagicLinkToken,
	type MagicLinkTokenStore,
	magicLinkTokenSchema,
	type Session,
	type SessionStore,
	sessionSchema,
	type User,
	type UserRole,
	type UserStore,
	userSchema,
} from "./identity-types.js";

const USERS_FILENAME = "users.json";
const SESSIONS_FILENAME = "sessions.json";
const MAGIC_LINK_TOKENS_FILENAME = "magic-link-tokens.json";

const userRecordSchema = z.record(z.string(), userSchema);
const sessionRecordSchema = z.record(z.string(), sessionSchema);
const magicLinkTokenRecordSchema = z.record(z.string(), magicLinkTokenSchema);

export interface JsonIdentityStorePaths {
	usersPath: string;
	sessionsPath: string;
	magicLinkTokensPath: string;
}

export function jsonIdentityStorePaths(rootDir: string): JsonIdentityStorePaths {
	return {
		usersPath: join(rootDir, USERS_FILENAME),
		sessionsPath: join(rootDir, SESSIONS_FILENAME),
		magicLinkTokensPath: join(rootDir, MAGIC_LINK_TOKENS_FILENAME),
	};
}

async function readMap<T>(filePath: string, schema: z.ZodType<Record<string, T>>): Promise<Record<string, T>> {
	try {
		const raw = await readFile(filePath, "utf8");
		if (!raw.trim()) return {};
		const parsed = JSON.parse(raw);
		return schema.parse(parsed);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

function lockFor(filePath: string): LockRequest {
	return { path: filePath, type: "file" };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export class JsonUserStore implements UserStore {
	constructor(private readonly filePath: string) {}

	async findByEmail(email: string): Promise<User | null> {
		const normalized = email.trim().toLowerCase();
		const all = await readMap(this.filePath, userRecordSchema);
		for (const user of Object.values(all)) {
			if (user.email.toLowerCase() === normalized) return user;
		}
		return null;
	}

	async findById(id: string): Promise<User | null> {
		const all = await readMap(this.filePath, userRecordSchema);
		return all[id] ?? null;
	}

	async create(input: { email: string; displayName?: string | null; role?: UserRole }): Promise<User> {
		return await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, userRecordSchema);
			const normalizedEmail = input.email.trim().toLowerCase();
			for (const existing of Object.values(all)) {
				if (existing.email.toLowerCase() === normalizedEmail) {
					throw new Error(`User with email "${normalizedEmail}" already exists.`);
				}
			}
			const user: User = {
				id: randomUUID(),
				email: normalizedEmail,
				displayName: input.displayName ?? null,
				role: input.role ?? "member",
				createdAt: new Date().toISOString(),
				lastLoginAt: null,
			};
			all[user.id] = user;
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
			return user;
		});
	}

	async recordLogin(userId: string): Promise<void> {
		await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, userRecordSchema);
			const user = all[userId];
			if (!user) return;
			all[userId] = { ...user, lastLoginAt: new Date().toISOString() };
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
		});
	}

	async list(): Promise<User[]> {
		const all = await readMap(this.filePath, userRecordSchema);
		return Object.values(all).sort((a, b) => a.email.localeCompare(b.email));
	}
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export class JsonSessionStore implements SessionStore {
	constructor(private readonly filePath: string) {}

	async create(input: { userId: string; ttlMs: number; userAgent?: string | null }): Promise<Session> {
		return await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, sessionRecordSchema);
			const issuedAt = new Date();
			const session: Session = {
				id: randomUUID(),
				userId: input.userId,
				issuedAt: issuedAt.toISOString(),
				expiresAt: new Date(issuedAt.getTime() + input.ttlMs).toISOString(),
				lastUsedAt: issuedAt.toISOString(),
				userAgent: input.userAgent ?? null,
			};
			all[session.id] = session;
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
			return session;
		});
	}

	async findValid(id: string): Promise<Session | null> {
		const all = await readMap(this.filePath, sessionRecordSchema);
		const session = all[id];
		if (!session) return null;
		if (Date.parse(session.expiresAt) <= Date.now()) {
			// Best-effort cleanup; ignore failures.
			void this.revoke(id);
			return null;
		}
		return session;
	}

	async touch(id: string): Promise<void> {
		await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, sessionRecordSchema);
			const session = all[id];
			if (!session) return;
			all[id] = { ...session, lastUsedAt: new Date().toISOString() };
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
		});
	}

	async revoke(id: string): Promise<void> {
		await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, sessionRecordSchema);
			if (!(id in all)) return;
			delete all[id];
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
		});
	}

	async revokeAllForUser(userId: string): Promise<void> {
		await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, sessionRecordSchema);
			let changed = false;
			for (const [id, session] of Object.entries(all)) {
				if (session.userId === userId) {
					delete all[id];
					changed = true;
				}
			}
			if (changed) {
				await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
			}
		});
	}

	async purgeExpired(): Promise<number> {
		return await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, sessionRecordSchema);
			const now = Date.now();
			let purged = 0;
			for (const [id, session] of Object.entries(all)) {
				if (Date.parse(session.expiresAt) <= now) {
					delete all[id];
					purged += 1;
				}
			}
			if (purged > 0) {
				await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
			}
			return purged;
		});
	}
}

// ---------------------------------------------------------------------------
// Magic-link tokens
// ---------------------------------------------------------------------------

export class JsonMagicLinkTokenStore implements MagicLinkTokenStore {
	constructor(private readonly filePath: string) {}

	async create(input: { email: string; tokenHash: string; ttlMs: number }): Promise<MagicLinkToken> {
		return await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, magicLinkTokenRecordSchema);
			const issuedAt = new Date();
			const token: MagicLinkToken = {
				id: randomUUID(),
				email: input.email.trim().toLowerCase(),
				tokenHash: input.tokenHash,
				issuedAt: issuedAt.toISOString(),
				expiresAt: new Date(issuedAt.getTime() + input.ttlMs).toISOString(),
				consumedAt: null,
			};
			all[token.id] = token;
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
			return token;
		});
	}

	async findValidByHash(tokenHash: string): Promise<MagicLinkToken | null> {
		const all = await readMap(this.filePath, magicLinkTokenRecordSchema);
		for (const token of Object.values(all)) {
			if (token.tokenHash !== tokenHash) continue;
			if (token.consumedAt) return null;
			if (Date.parse(token.expiresAt) <= Date.now()) return null;
			return token;
		}
		return null;
	}

	async consume(id: string): Promise<void> {
		await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, magicLinkTokenRecordSchema);
			const token = all[id];
			if (!token) return;
			all[id] = { ...token, consumedAt: new Date().toISOString() };
			await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
		});
	}

	async purgeExpired(): Promise<number> {
		return await lockedFileSystem.withLock(lockFor(this.filePath), async () => {
			const all = await readMap(this.filePath, magicLinkTokenRecordSchema);
			const now = Date.now();
			let purged = 0;
			for (const [id, token] of Object.entries(all)) {
				const expired = Date.parse(token.expiresAt) <= now;
				if (expired || token.consumedAt) {
					delete all[id];
					purged += 1;
				}
			}
			if (purged > 0) {
				await lockedFileSystem.writeJsonFileAtomic(this.filePath, all, { lock: null });
			}
			return purged;
		});
	}
}
