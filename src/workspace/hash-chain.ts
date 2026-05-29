/**
 * Hash-chain primitive shared by event-log style append-only modules.
 *
 * `chainHash(prevHash, payload)` deterministically produces a SHA-256
 * hex digest from the previous chainHash and a canonical JSON of the
 * current entry's payload (i.e. the entry without its own chainHash).
 * Splitting the helper out keeps the crypto in one tested place; KPI
 * events use it via `kpi-event-log.ts`.
 *
 * Pure function: no IO, no clock side-effects.
 */

import { createHash } from "node:crypto";

/** First entry in any chain links against this sentinel. */
export const CHAIN_HASH_GENESIS = "0";

/**
 * Produce the chain hash for a new entry.
 *
 * @param prevHash The previous entry's chainHash, or `CHAIN_HASH_GENESIS`
 *                 for the first entry in a file.
 * @param payload  The new entry minus its own chainHash. Order doesn't
 *                 matter — keys are sorted before stringifying so the
 *                 hash is deterministic across producers.
 */
export function chainHash(prevHash: string, payload: unknown): string {
	const canonical = canonicalize(payload);
	return createHash("sha256").update(`${prevHash}\n${canonical}`).digest("hex");
}

/**
 * Walk a sequence of entries (each with `prevHash` + `chainHash`) and
 * return the index of the first break, or `null` when the chain is
 * intact. Use for `kanban kpi events verify`.
 *
 * Each entry must expose `prevHash` and `chainHash` strings; everything
 * else is treated as opaque payload.
 */
export function findChainBreak<T extends { prevHash: string; chainHash: string }>(
	entries: readonly T[],
): { index: number; reason: string } | null {
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i]!;
		const expectedPrev = i === 0 ? CHAIN_HASH_GENESIS : entries[i - 1]!.chainHash;
		if (entry.prevHash !== expectedPrev) {
			return {
				index: i,
				reason: `prevHash mismatch: expected ${expectedPrev}, got ${entry.prevHash}`,
			};
		}
		const { chainHash: _ignored, ...payload } = entry;
		const recomputed = chainHash(entry.prevHash, payload);
		if (entry.chainHash !== recomputed) {
			return {
				index: i,
				reason: `chainHash mismatch: recomputed ${recomputed}, got ${entry.chainHash}`,
			};
		}
	}
	return null;
}

/**
 * Stable JSON stringification that sorts object keys recursively. Two
 * payloads with the same content produce the same string regardless
 * of how the producer ordered keys, which keeps chain hashes
 * deterministic.
 */
function canonicalize(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const out: Record<string, unknown> = {};
	for (const [k, v] of entries) out[k] = sortKeys(v);
	return out;
}
