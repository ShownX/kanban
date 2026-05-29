import { describe, expect, it } from "vitest";
import { CHAIN_HASH_GENESIS, chainHash, findChainBreak } from "../../../src/workspace/hash-chain";
import { compactKpiEvents } from "../../../src/workspace/kpi-event-compaction";
import type { KpiEvent } from "../../../src/workspace/kpi-event-log";

function buildChain(events: Array<Omit<KpiEvent, "chainHash" | "prevHash" | "seq">>): KpiEvent[] {
	const result: KpiEvent[] = [];
	let prev = CHAIN_HASH_GENESIS;
	let seq = 1;
	for (const e of events) {
		const partial = { ...e, seq, prevHash: prev };
		const hash = chainHash(prev, partial);
		const full = { ...partial, chainHash: hash } as KpiEvent;
		result.push(full);
		prev = hash;
		seq += 1;
	}
	return result;
}

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

describe("compactKpiEvents", () => {
	it("returns the same events with removed=null when nothing is eligible", () => {
		const events = buildChain([
			{
				ts: "2026-07-15T10:00:00.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "open",
				statusTo: "met",
			},
		]);
		const result = compactKpiEvents(events, { retainDays: 90, nowMs: NOW });
		expect(result.removed).toBeNull();
		expect(result.events).toEqual(events);
	});

	it("drops eligible non-status events but keeps the latest status_changed per (scope, day)", () => {
		const events = buildChain([
			// Eligible: well past the 30-day cutoff at NOW.
			{
				ts: "2026-04-01T10:00:00.000Z",
				type: "reading_appended",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
			},
			{
				ts: "2026-04-01T10:00:01.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "open",
				statusTo: "met",
			},
			{
				ts: "2026-04-01T20:00:00.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "met",
				statusTo: "missed",
			},
			// Recent: keep verbatim.
			{
				ts: "2026-07-30T10:00:00.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "missed",
				statusTo: "met",
			},
		]);
		const result = compactKpiEvents(events, { retainDays: 30, nowMs: NOW });
		expect(result.removed?.count).toBe(2);
		// Should have: 1 kept status_changed (the latest from 04-01) + 1 marker + 1 recent
		expect(result.events).toHaveLength(3);
		const types = result.events.map((e) => e.type);
		expect(types).toEqual(["status_changed", "chain_compacted", "status_changed"]);
		expect(result.events[1]!.compaction).toMatchObject({
			removedSeqStart: 1,
			removedSeqEnd: 2,
		});
	});

	it("produces a chain that re-verifies after compaction", () => {
		const events = buildChain([
			{
				ts: "2026-04-01T10:00:00.000Z",
				type: "reading_appended",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
			},
			{
				ts: "2026-04-01T10:00:01.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "open",
				statusTo: "met",
			},
			{
				ts: "2026-07-30T10:00:00.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "met",
				statusTo: "missed",
			},
		]);
		const result = compactKpiEvents(events, { retainDays: 30, nowMs: NOW });
		expect(result.removed).not.toBeNull();
		expect(findChainBreak(result.events)).toBeNull();
	});

	it("renumbers seq from 1 in the rebuilt event list", () => {
		const events = buildChain([
			{
				ts: "2026-04-01T10:00:00.000Z",
				type: "reading_appended",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
			},
			{
				ts: "2026-04-01T10:00:01.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "open",
				statusTo: "met",
			},
		]);
		const result = compactKpiEvents(events, { retainDays: 30, nowMs: NOW });
		expect(result.events.map((e) => e.seq)).toEqual([1, 2]);
	});

	it("preserves recent events verbatim (only seq/prevHash/chainHash get rewired)", () => {
		const events = buildChain([
			{
				ts: "2026-04-01T10:00:01.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "open",
				statusTo: "met",
			},
			{
				ts: "2026-07-30T10:00:00.000Z",
				type: "reading_appended",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				reading: { recordedAt: "2026-07-30T10:00:00.000Z", source: "manual", numericValue: 42 },
			},
		]);
		const result = compactKpiEvents(events, { retainDays: 30, nowMs: NOW });
		const recent = result.events[result.events.length - 1]!;
		expect(recent.type).toBe("reading_appended");
		expect(recent.reading?.numericValue).toBe(42);
	});

	it("returns no-op result when there are eligible events but they're all already kept", () => {
		// One status_changed, one day - nothing to drop.
		const events = buildChain([
			{
				ts: "2026-04-01T10:00:00.000Z",
				type: "status_changed",
				scope: { kind: "project", itemId: "i", kpiId: "k" },
				statusFrom: "open",
				statusTo: "met",
			},
		]);
		const result = compactKpiEvents(events, { retainDays: 30, nowMs: NOW });
		expect(result.removed).toBeNull();
		expect(result.events).toEqual(events);
	});

	it("works on empty input", () => {
		const result = compactKpiEvents([], { retainDays: 30, nowMs: NOW });
		expect(result).toEqual({ events: [], removed: null });
	});
});
