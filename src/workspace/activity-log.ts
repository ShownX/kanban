import { createHash } from "node:crypto";

import { appendJsonLine, readJsonLines } from "../fs/locked-jsonl-append.js";

/**
 * Tamper-evident activity log for multi-agent cooperation.
 *
 * Each entry carries a SHA-256 hash that mixes in the previous entry's
 * hash, the current payload, and the timestamp. Reading the log can verify
 * the chain — any post-hoc edit to a previous entry breaks every hash that
 * follows it.
 *
 * This is NOT a cryptographic guarantee against an attacker who can rewrite
 * the entire file: they could recompute the chain after editing. The goal
 * here is more modest — catch accidental edits (an agent's tool call that
 * rewrites the changelog), and give an obvious tripwire when something is
 * out of order. For real attack-resistance you'd anchor a periodic hash to
 * git or an external system.
 *
 * Schema is intentionally minimal so any agent can append without coupling
 * to a domain-specific shape:
 *   - `agent`:    short identifier of the writer (project agent slug, etc.)
 *   - `event`:    string describing what happened
 *   - `payload`:  free-form JSON-serializable detail
 *   - `recordedAt`: ISO-8601 string set by the helper
 *   - `seq`:      monotonic counter starting at 0
 *   - `prevHash`: hex-encoded hash of the prior entry, or null for seq 0
 *   - `hash`:     hex-encoded hash of this entry
 */

export interface ActivityLogEntryInput {
	agent: string;
	event: string;
	payload?: Record<string, unknown>;
}

export interface ActivityLogEntry {
	agent: string;
	event: string;
	payload?: Record<string, unknown>;
	recordedAt: string;
	seq: number;
	prevHash: string | null;
	hash: string;
}

export interface ActivityLogVerification {
	ok: boolean;
	totalEntries: number;
	firstBrokenSeq: number | null;
	reason: "chain_broken" | "hash_mismatch" | "non_monotonic_seq" | null;
	message: string;
}

/**
 * Append a new activity log entry. Reads the current tail under lock, then
 * computes the next entry's hash chain pointer and writes the line.
 */
export async function appendActivityLogEntry(logPath: string, input: ActivityLogEntryInput): Promise<ActivityLogEntry> {
	const existing = await readJsonLines<ActivityLogEntry>(logPath);
	const tail = existing.at(-1) ?? null;
	const seq = (tail?.seq ?? -1) + 1;
	const prevHash = tail?.hash ?? null;
	const recordedAt = new Date().toISOString();
	const entryWithoutHash = {
		agent: input.agent,
		event: input.event,
		...(input.payload ? { payload: input.payload } : {}),
		recordedAt,
		seq,
		prevHash,
	};
	const hash = computeEntryHash(entryWithoutHash);
	const entry: ActivityLogEntry = { ...entryWithoutHash, hash };
	await appendJsonLine(logPath, entry);
	return entry;
}

/**
 * Read the full log and verify the hash chain end-to-end. The check is
 * cheap and should be cheap to run periodically (e.g. when the validator
 * generates its report).
 */
export async function verifyActivityLog(logPath: string): Promise<ActivityLogVerification> {
	const entries = await readJsonLines<ActivityLogEntry>(logPath);
	if (entries.length === 0) {
		return {
			ok: true,
			totalEntries: 0,
			firstBrokenSeq: null,
			reason: null,
			message: "Empty log — vacuously valid.",
		};
	}
	let expectedSeq = 0;
	let expectedPrevHash: string | null = null;
	for (const entry of entries) {
		if (entry.seq !== expectedSeq) {
			return {
				ok: false,
				totalEntries: entries.length,
				firstBrokenSeq: entry.seq,
				reason: "non_monotonic_seq",
				message: `Expected seq=${expectedSeq} but found seq=${entry.seq}.`,
			};
		}
		if (entry.prevHash !== expectedPrevHash) {
			return {
				ok: false,
				totalEntries: entries.length,
				firstBrokenSeq: entry.seq,
				reason: "chain_broken",
				message: `Entry seq=${entry.seq} expected prevHash=${expectedPrevHash ?? "null"} but found ${entry.prevHash ?? "null"}.`,
			};
		}
		const recomputed = computeEntryHash({
			agent: entry.agent,
			event: entry.event,
			...(entry.payload ? { payload: entry.payload } : {}),
			recordedAt: entry.recordedAt,
			seq: entry.seq,
			prevHash: entry.prevHash,
		});
		if (recomputed !== entry.hash) {
			return {
				ok: false,
				totalEntries: entries.length,
				firstBrokenSeq: entry.seq,
				reason: "hash_mismatch",
				message: `Entry seq=${entry.seq} hash mismatch — payload was edited after recording.`,
			};
		}
		expectedSeq += 1;
		expectedPrevHash = entry.hash;
	}
	return {
		ok: true,
		totalEntries: entries.length,
		firstBrokenSeq: null,
		reason: null,
		message: `All ${entries.length} entries verified.`,
	};
}

/**
 * Convenience read that returns the parsed entries without verification.
 */
export async function readActivityLog(logPath: string): Promise<ActivityLogEntry[]> {
	return await readJsonLines<ActivityLogEntry>(logPath);
}

function computeEntryHash(entry: Omit<ActivityLogEntry, "hash">): string {
	// Hash is computed over a deterministic JSON representation. Field order
	// is fixed so the hash is reproducible across runtimes.
	const canonical = JSON.stringify({
		agent: entry.agent,
		event: entry.event,
		payload: entry.payload ?? null,
		recordedAt: entry.recordedAt,
		seq: entry.seq,
		prevHash: entry.prevHash,
	});
	return createHash("sha256").update(canonical).digest("hex");
}
