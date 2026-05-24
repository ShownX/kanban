/**
 * Shared identity types for the multi-user auth slice.
 *
 * The store interfaces here are intentionally narrow so we can swap
 * implementations (in-memory for tests, JSON-on-disk for self-hosted,
 * Postgres later) without touching call sites.
 *
 * NOTE: nothing in this module touches a filesystem or a database — it
 * just declares the contract. Implementations live next to it.
 */

import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userSchema = z.object({
	id: z.string(),
	email: z.string().email(),
	displayName: z.string().nullable(),
	role: userRoleSchema,
	createdAt: z.string(),
	lastLoginAt: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
	id: z.string(),
	userId: z.string(),
	issuedAt: z.string(),
	expiresAt: z.string(),
	lastUsedAt: z.string(),
	userAgent: z.string().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

export const magicLinkTokenSchema = z.object({
	id: z.string(),
	email: z.string().email(),
	tokenHash: z.string(),
	issuedAt: z.string(),
	expiresAt: z.string(),
	consumedAt: z.string().nullable(),
});
export type MagicLinkToken = z.infer<typeof magicLinkTokenSchema>;

// ---------------------------------------------------------------------------
// Store interfaces
// ---------------------------------------------------------------------------

export interface UserStore {
	/** Fetch a user by email (case-insensitive). Returns null when missing. */
	findByEmail(email: string): Promise<User | null>;
	/** Fetch by id. Returns null when missing. */
	findById(id: string): Promise<User | null>;
	/** Insert a new user; throws if the email already exists. */
	create(input: { email: string; displayName?: string | null; role?: UserRole }): Promise<User>;
	/** Update lastLoginAt to the current time. No-op if the user is missing. */
	recordLogin(userId: string): Promise<void>;
	/** Enumerate every user. Used by the admin UI; not on the hot path. */
	list(): Promise<User[]>;
}

export interface SessionStore {
	create(input: { userId: string; ttlMs: number; userAgent?: string | null }): Promise<Session>;
	/** Fetch by id, return null when missing OR expired. */
	findValid(id: string): Promise<Session | null>;
	/** Update lastUsedAt to now. Best-effort; no return value. */
	touch(id: string): Promise<void>;
	/** Invalidate by id; idempotent. */
	revoke(id: string): Promise<void>;
	/** Invalidate every session for a user; used by admin / forced logout. */
	revokeAllForUser(userId: string): Promise<void>;
	/** Garbage-collect expired sessions; safe to call periodically. */
	purgeExpired(): Promise<number>;
}

export interface MagicLinkTokenStore {
	/** Issue a new token; the *plaintext* lives only in memory at the call site. */
	create(input: { email: string; tokenHash: string; ttlMs: number }): Promise<MagicLinkToken>;
	/** Find a still-valid token by hash. Returns null when missing, expired, or already consumed. */
	findValidByHash(tokenHash: string): Promise<MagicLinkToken | null>;
	/** Mark a token as consumed (single-use). */
	consume(id: string): Promise<void>;
	/** GC expired/consumed tokens; safe to call periodically. */
	purgeExpired(): Promise<number>;
}
