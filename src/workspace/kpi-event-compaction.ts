/**
 * KPI event log compaction (Phase D3).
 *
 * Pure algorithm. Caller hands in the loaded events + retention
 * config; this module returns the kept events plus a `chain_compacted`
 * marker that records what was removed. The IO + locking lives in
 * `kpi-event-log.ts` (where `compactKpiEventLog` rewrites the file).
 *
 * Algorithm (per .plan/docs/kpi-tracking-phase-d.md §"Event log
 * retention"):
 *
 *   1. Find cutoff = oldest event ts >= now - retainDays. Events
 *      with ts < cutoff are eligible for compaction.
 *   2. Among eligible events, group by (scope, day). Keep the latest
 *      `status_changed` per group; drop everything else (those events
 *      are recoverable from kpi-state.json if needed).
 *   3. Emit a `chain_compacted` marker event recording the removed
 *      seq range, the pre-compaction tail's chainHash, and the
 *      cutoff timestamp.
 *   4. Renumber kept entries from seq=1, fresh chainHash chain rooted
 *      at GENESIS, then the marker, then the un-eligible (recent)
 *      events appended after.
 *
 * The marker's chainHash becomes the prevHash of the first event
 * after compaction. Verifiers walk through the marker without trying
 * to re-derive the dropped events' hashes — see `findChainBreak` in
 * `hash-chain.ts`.
 */

import { CHAIN_HASH_GENESIS, chainHash } from "./hash-chain.js";
import type { KpiEvent, KpiEventInput } from "./kpi-event-log.js";

export interface CompactionConfig {
	/** Events older than this many days are eligible for compaction. */
	retainDays: number;
	/**
	 * Reference time for the cutoff. Defaults to wall-clock; tests pass
	 * an explicit value to keep the function deterministic.
	 */
	nowMs?: number;
}

export interface CompactionResult {
	/** The new event list to write (already renumbered + rehashed). */
	events: KpiEvent[];
	/** seq range of the dropped events; null when nothing was removed. */
	removed: { start: number; end: number; count: number } | null;
}

/** Default retention when none is configured. */
export const DEFAULT_RETAIN_DAYS = 90;

export function compactKpiEvents(events: readonly KpiEvent[], config: CompactionConfig): CompactionResult {
	if (events.length === 0) return { events: [], removed: null };

	const nowMs = config.nowMs ?? Date.now();
	const retainMs = config.retainDays * 24 * 60 * 60 * 1000;
	const cutoffMs = nowMs - retainMs;
	const cutoffTs = new Date(cutoffMs).toISOString();

	const eligible = events.filter((e) => Date.parse(e.ts) < cutoffMs && e.type !== "chain_compacted");
	const recent = events.filter((e) => Date.parse(e.ts) >= cutoffMs);
	const existingMarkers = events.filter((e) => e.type === "chain_compacted");

	if (eligible.length === 0) {
		return { events: [...events], removed: null };
	}

	const kept = pickKeepers(eligible);
	const droppedCount = eligible.length - kept.length;
	if (droppedCount === 0) {
		return { events: [...events], removed: null };
	}

	const dropped = eligible.filter((e) => !kept.includes(e));
	const removedSeqStart = Math.min(...dropped.map((e) => e.seq));
	const removedSeqEnd = Math.max(...dropped.map((e) => e.seq));
	const preCompactionTail = events[events.length - 1];
	const preCompactionChainHash = preCompactionTail ? preCompactionTail.chainHash : CHAIN_HASH_GENESIS;

	// Rebuild: existing markers (preserved verbatim), then kept eligibles
	// renumbered, then the new marker, then recent events renumbered.
	const rebuilt: KpiEvent[] = [];
	let prevHash = CHAIN_HASH_GENESIS;
	let nextSeq = 1;

	const replayInputs: Array<KpiEventInput & { ts: string; markerMeta?: never }> = [
		...existingMarkers.map((m) => stripChain(m)),
		...sortByTs(kept).map((m) => stripChain(m)),
	];
	for (const input of replayInputs) {
		const partial = { ...input, seq: nextSeq, prevHash };
		const hash = chainHash(prevHash, partial);
		rebuilt.push({ ...partial, chainHash: hash } as KpiEvent);
		prevHash = hash;
		nextSeq += 1;
	}

	const markerInput: KpiEventInput = {
		type: "chain_compacted",
		scope: { kind: "log" },
		compaction: {
			removedSeqStart,
			removedSeqEnd,
			preCompactionChainHash,
			cutoffTs,
		},
	};
	const markerPartial = {
		...markerInput,
		seq: nextSeq,
		ts: new Date(nowMs).toISOString(),
		prevHash,
	};
	const markerHash = chainHash(prevHash, markerPartial);
	rebuilt.push({ ...markerPartial, chainHash: markerHash } as KpiEvent);
	prevHash = markerHash;
	nextSeq += 1;

	for (const event of recent) {
		const stripped = stripChain(event);
		const partial = { ...stripped, seq: nextSeq, prevHash };
		const hash = chainHash(prevHash, partial);
		rebuilt.push({ ...partial, chainHash: hash } as KpiEvent);
		prevHash = hash;
		nextSeq += 1;
	}

	return {
		events: rebuilt,
		removed: { start: removedSeqStart, end: removedSeqEnd, count: droppedCount },
	};
}

/**
 * Group eligible events by `(scope, day)` and keep the latest
 * `status_changed` per group. Status_changed events are the only ones
 * the chart layer consumes after compaction; the rest are recoverable
 * from kpi-state.json.
 */
function pickKeepers(eligible: readonly KpiEvent[]): KpiEvent[] {
	const groups = new Map<string, KpiEvent>();
	for (const event of eligible) {
		if (event.type !== "status_changed") continue;
		const key = `${scopeKey(event)}|${event.ts.slice(0, 10)}`;
		const existing = groups.get(key);
		if (!existing || event.ts > existing.ts) groups.set(key, event);
	}
	return [...groups.values()];
}

function scopeKey(event: KpiEvent): string {
	switch (event.scope.kind) {
		case "project":
			return `p/${event.scope.itemId}/${event.scope.kpiId}`;
		case "task":
			return `t/${event.scope.taskId}/${event.scope.subKpiId}`;
		case "log":
			return "log";
	}
}

function sortByTs(events: readonly KpiEvent[]): KpiEvent[] {
	return [...events].sort((a, b) => a.ts.localeCompare(b.ts));
}

function stripChain(event: KpiEvent): KpiEventInput & { ts: string } {
	const { seq: _seq, prevHash: _prevHash, chainHash: _chainHash, ...rest } = event;
	return rest;
}
