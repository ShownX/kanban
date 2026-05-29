/**
 * KPI event log — Phase C, branch C1.
 *
 * Append-only JSONL at `.kanban/kpi-events.jsonl`. One event per state
 * mutation (reading appended, override set/cleared) plus an explicit
 * `status_changed` event whenever a mutation flips the resolved status.
 *
 * Each line carries a hash chain (see `hash-chain.ts`) so corruption /
 * hand-edits are detectable via `kanban kpi events verify`.
 *
 * Storage is gitignored. The audit trail that travels with git lives
 * in the markdown report files (see Phase B's `## KPI Readings`).
 */

import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { lockedFileSystem } from "../fs/locked-file-system.js";
import { CHAIN_HASH_GENESIS, chainHash, findChainBreak } from "./hash-chain.js";
import { compactKpiEvents } from "./kpi-event-compaction.js";
import { kpiOverrideSchema, kpiReadingSchema, kpiStatusSchema } from "./project-kpi.js";

const KANBAN_DIR = ".kanban";
const KPI_EVENTS_FILE = "kpi-events.jsonl";

export const kpiEventTypeSchema = z.enum([
	"reading_appended",
	"override_set",
	"override_cleared",
	"status_changed",
	"chain_compacted",
]);
export type KpiEventType = z.infer<typeof kpiEventTypeSchema>;

export const kpiEventScopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("project"), itemId: z.string(), kpiId: z.string() }),
	z.object({ kind: z.literal("task"), taskId: z.string(), subKpiId: z.string() }),
	z.object({ kind: z.literal("log") }),
]);
export type KpiEventScope = z.infer<typeof kpiEventScopeSchema>;

/**
 * Metadata for `chain_compacted` events. The marker records what was
 * removed so an external auditor with a pre-compaction copy can still
 * verify the surviving chain links up to a known boundary.
 */
export const kpiEventCompactionMetaSchema = z.object({
	removedSeqStart: z.number().int().positive(),
	removedSeqEnd: z.number().int().positive(),
	preCompactionChainHash: z.string(),
	cutoffTs: z.string(),
});
export type KpiEventCompactionMeta = z.infer<typeof kpiEventCompactionMetaSchema>;

export const kpiEventSchema = z.object({
	seq: z.number().int().positive(),
	ts: z.string(),
	type: kpiEventTypeSchema,
	scope: kpiEventScopeSchema,
	reading: kpiReadingSchema.optional(),
	override: kpiOverrideSchema.optional(),
	statusFrom: kpiStatusSchema.optional(),
	statusTo: kpiStatusSchema.optional(),
	compaction: kpiEventCompactionMetaSchema.optional(),
	prevHash: z.string(),
	chainHash: z.string(),
});
export type KpiEvent = z.infer<typeof kpiEventSchema>;

/** Shape passed by callers — the recorder fills in seq/ts/prevHash/chainHash. */
export type KpiEventInput = Omit<KpiEvent, "seq" | "ts" | "prevHash" | "chainHash">;

function eventLogPath(workspaceRoot: string): string {
	return join(workspaceRoot, KANBAN_DIR, KPI_EVENTS_FILE);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Load every event from the log. Returns [] when the file is absent. */
export async function readKpiEvents(workspaceRoot: string): Promise<KpiEvent[]> {
	const path = eventLogPath(workspaceRoot);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
	const events: KpiEvent[] = [];
	const lines = raw.split("\n");
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (line.trim() === "") continue;
		try {
			const parsed = kpiEventSchema.parse(JSON.parse(line));
			events.push(parsed);
		} catch (error) {
			// Re-raise with line context so verify can localize torn lines.
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Malformed KPI event on line ${i + 1}: ${message}`);
		}
	}
	return events;
}

/**
 * Walk the chain and return the index of the first broken entry, or
 * null when the file is clean. Any malformed JSON throws via
 * `readKpiEvents` before we get here.
 */
export async function verifyKpiEventChain(
	workspaceRoot: string,
): Promise<{ ok: true; count: number } | { ok: false; index: number; reason: string }> {
	const events = await readKpiEvents(workspaceRoot);
	for (let i = 0; i < events.length; i += 1) {
		const entry = events[i]!;
		if (entry.seq !== i + 1) {
			return { ok: false, index: i, reason: `seq mismatch: expected ${i + 1}, got ${entry.seq}` };
		}
	}
	const broken = findChainBreak(events);
	if (broken) return { ok: false, ...broken };
	return { ok: true, count: events.length };
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append one or more events under a single lock. Each event's seq /
 * prevHash / chainHash / ts is filled in from the prior tail, so the
 * caller passes only the semantic fields (`type`, `scope`, optional
 * payload). Multiple events from one logical mutation (e.g. a
 * reading_appended plus a status_changed) share the same lock and are
 * written in order.
 */
export async function appendKpiEvents(workspaceRoot: string, inputs: readonly KpiEventInput[]): Promise<KpiEvent[]> {
	if (inputs.length === 0) return [];
	const path = eventLogPath(workspaceRoot);
	let written: KpiEvent[] = [];
	await lockedFileSystem.withLock({ path, type: "file" }, async () => {
		await mkdir(dirname(path), { recursive: true });
		const existing = await readKpiEvents(workspaceRoot);
		let prevHash = existing.length > 0 ? existing[existing.length - 1]!.chainHash : CHAIN_HASH_GENESIS;
		let nextSeq = existing.length + 1;
		const ts = new Date().toISOString();
		const fresh: KpiEvent[] = [];
		const lines: string[] = [];
		for (const input of inputs) {
			const partial = { ...input, seq: nextSeq, ts, prevHash };
			const hash = chainHash(prevHash, partial);
			const event: KpiEvent = { ...partial, chainHash: hash };
			fresh.push(event);
			lines.push(JSON.stringify(event));
			prevHash = hash;
			nextSeq += 1;
		}
		await appendFile(path, `${lines.join("\n")}\n`, "utf8");
		written = fresh;
	});
	return written;
}

// ---------------------------------------------------------------------------
// Compaction (Phase D3)
// ---------------------------------------------------------------------------

export interface KpiEventLogSizeInfo {
	bytes: number;
	exists: boolean;
}

/** Stat the file. Returns 0 bytes when missing. */
export async function getKpiEventLogSize(workspaceRoot: string): Promise<KpiEventLogSizeInfo> {
	const path = eventLogPath(workspaceRoot);
	try {
		const info = await stat(path);
		return { bytes: info.size, exists: true };
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return { bytes: 0, exists: false };
		}
		throw error;
	}
}

/**
 * Atomically replace the event log with the given event list. The
 * locked-file system handles temp-file + rename so concurrent readers
 * never see a torn file.
 */
export async function rewriteKpiEventLog(workspaceRoot: string, events: readonly KpiEvent[]): Promise<void> {
	const path = eventLogPath(workspaceRoot);
	await mkdir(dirname(path), { recursive: true });
	const body = events.length === 0 ? "" : `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
	await lockedFileSystem.writeTextFileAtomic(path, body, { lock: { path, type: "file" } });
}

/**
 * Read events, run the pure compaction algorithm, write the result
 * back. Returns null when nothing was eligible for removal so callers
 * can no-op.
 */
export async function compactKpiEventLog(
	workspaceRoot: string,
	config: { retainDays: number; nowMs?: number },
): Promise<{ removed: number; total: number } | null> {
	const path = eventLogPath(workspaceRoot);
	let result: { removed: number; total: number } | null = null;
	await lockedFileSystem.withLock({ path, type: "file" }, async () => {
		const existing = await readKpiEvents(workspaceRoot);
		const compacted = compactKpiEvents(existing, config);
		if (!compacted.removed) return;
		await mkdir(dirname(path), { recursive: true });
		const body = `${compacted.events.map((e) => JSON.stringify(e)).join("\n")}\n`;
		// Already inside the lock, so use writeTextFileAtomic with lock:null
		// to avoid the helper trying to re-acquire.
		await lockedFileSystem.writeTextFileAtomic(path, body, { lock: null });
		result = { removed: compacted.removed.count, total: compacted.events.length };
	});
	return result;
}
