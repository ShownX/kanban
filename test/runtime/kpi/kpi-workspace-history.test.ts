import { describe, expect, it } from "vitest";

import type { KpiEvent } from "../../../src/workspace/kpi-event-log";
import type { KpiSnapshot } from "../../../src/workspace/kpi-snapshot";
import { oldestOpenKpis, workspaceKpiSummary, workspaceVelocity } from "../../../src/workspace/kpi-workspace-history";

function snapshot(
	itemId: string,
	statuses: Array<{ id: string; status: KpiSnapshot["kpis"][number]["evaluation"]["status"] }>,
): KpiSnapshot {
	const kpis = statuses.map(({ id, status }) => ({
		definition: {
			id,
			label: id,
			target: { kind: "boolean" } as const,
			acceptance: "manual" as const,
			aggregate: "latest" as const,
			readings: [],
		},
		evaluation: {
			status,
			aggregatedValue: null,
			contributingReadings: [],
			warnings: [],
		},
	}));
	const blocking = statuses.filter((s) => s.status !== "met" && s.status !== "waived").map((s) => s.id);
	return {
		itemId,
		kpis,
		allMet: blocking.length === 0,
		blockingKpis: blocking,
	};
}

function projectEvent(itemId: string, kpiId: string, base: Partial<KpiEvent>): KpiEvent {
	return {
		seq: 1,
		ts: "2026-05-29T12:00:00.000Z",
		type: "status_changed",
		scope: { kind: "project", itemId, kpiId },
		prevHash: "0",
		chainHash: "x",
		...base,
	} as KpiEvent;
}

describe("workspaceKpiSummary", () => {
	it("returns zeros for an empty workspace", () => {
		expect(workspaceKpiSummary([])).toEqual({
			totalItems: 0,
			totalKpis: 0,
			metKpis: 0,
			regressionCount: 0,
			blockedItemIds: [],
		});
	});

	it("rolls met + waived into metKpis and counts blocked items", () => {
		const summary = workspaceKpiSummary([
			{
				itemId: "item-a",
				snapshot: snapshot("item-a", [
					{ id: "k1", status: "met" },
					{ id: "k2", status: "waived" },
				]),
				regressionCount: 0,
			},
			{
				itemId: "item-b",
				snapshot: snapshot("item-b", [
					{ id: "k1", status: "met" },
					{ id: "k2", status: "open" },
				]),
				regressionCount: 1,
			},
		]);
		expect(summary).toEqual({
			totalItems: 2,
			totalKpis: 4,
			metKpis: 3,
			regressionCount: 1,
			blockedItemIds: ["item-b"],
		});
	});

	it("doesn't count items with no KPIs as blocked", () => {
		const summary = workspaceKpiSummary([{ itemId: "empty", snapshot: snapshot("empty", []), regressionCount: 0 }]);
		expect(summary.blockedItemIds).toEqual([]);
	});
});

describe("oldestOpenKpis", () => {
	it("returns [] when no item has an open KPI with events", () => {
		const events: KpiEvent[] = [];
		const perItem = [
			{
				itemId: "item-a",
				snapshot: snapshot("item-a", [{ id: "k1", status: "met" }]),
				regressionCount: 0,
			},
		];
		expect(oldestOpenKpis(events, perItem)).toEqual([]);
	});

	it("sorts by openedAt ascending and computes daysOpen", () => {
		const now = Date.parse("2026-05-29T00:00:00.000Z");
		const events: KpiEvent[] = [
			projectEvent("item-a", "old_kpi", {
				type: "reading_appended",
				ts: "2026-04-01T10:00:00.000Z",
				seq: 1,
			}),
			projectEvent("item-b", "newer_kpi", {
				type: "reading_appended",
				ts: "2026-05-15T10:00:00.000Z",
				seq: 2,
			}),
		];
		const perItem = [
			{
				itemId: "item-a",
				snapshot: snapshot("item-a", [{ id: "old_kpi", status: "open" }]),
				regressionCount: 0,
			},
			{
				itemId: "item-b",
				snapshot: snapshot("item-b", [{ id: "newer_kpi", status: "open" }]),
				regressionCount: 0,
			},
		];
		const result = oldestOpenKpis(events, perItem, 10, now);
		expect(result.map((e) => e.kpiId)).toEqual(["old_kpi", "newer_kpi"]);
		expect(result[0]?.daysOpen).toBeGreaterThan(result[1]!.daysOpen);
	});

	it("omits KPIs that exist in markdown but have no events yet", () => {
		const events: KpiEvent[] = [];
		const perItem = [
			{
				itemId: "item-a",
				snapshot: snapshot("item-a", [{ id: "untouched", status: "open" }]),
				regressionCount: 0,
			},
		];
		expect(oldestOpenKpis(events, perItem)).toEqual([]);
	});

	it("excludes non-open KPIs", () => {
		const events: KpiEvent[] = [
			projectEvent("item-a", "k1", { type: "reading_appended", ts: "2026-04-01T10:00:00.000Z", seq: 1 }),
		];
		const perItem = [
			{
				itemId: "item-a",
				snapshot: snapshot("item-a", [{ id: "k1", status: "missed" }]),
				regressionCount: 0,
			},
		];
		expect(oldestOpenKpis(events, perItem)).toEqual([]);
	});

	it("respects the limit", () => {
		const events: KpiEvent[] = Array.from({ length: 5 }, (_, i) =>
			projectEvent("item-a", `k${i}`, {
				type: "reading_appended",
				ts: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
				seq: i + 1,
			}),
		);
		const perItem = [
			{
				itemId: "item-a",
				snapshot: snapshot(
					"item-a",
					Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, status: "open" as const })),
				),
				regressionCount: 0,
			},
		];
		expect(oldestOpenKpis(events, perItem, 2)).toHaveLength(2);
	});
});

describe("workspaceVelocity", () => {
	it("sums met-flips per day across items", () => {
		const events: KpiEvent[] = [
			projectEvent("item-a", "k1", {
				ts: "2026-05-26T10:00:00.000Z",
				statusFrom: "open",
				statusTo: "met",
				seq: 1,
			}),
			projectEvent("item-b", "k1", {
				ts: "2026-05-26T20:00:00.000Z",
				statusFrom: "open",
				statusTo: "met",
				seq: 2,
			}),
			projectEvent("item-a", "k2", {
				ts: "2026-05-27T08:00:00.000Z",
				statusFrom: "missed",
				statusTo: "met",
				seq: 3,
			}),
		];
		expect(workspaceVelocity(events, null)).toEqual([
			{ day: "2026-05-26", metCount: 2 },
			{ day: "2026-05-27", metCount: 1 },
		]);
	});

	it("excludes met -> met re-confirms", () => {
		const events: KpiEvent[] = [
			projectEvent("item-a", "k1", {
				ts: "2026-05-26T10:00:00.000Z",
				statusFrom: "met",
				statusTo: "met",
				seq: 1,
			}),
		];
		expect(workspaceVelocity(events, null)).toEqual([]);
	});

	it("excludes task-scope events", () => {
		const events: KpiEvent[] = [
			{
				seq: 1,
				ts: "2026-05-26T10:00:00.000Z",
				type: "status_changed",
				scope: { kind: "task", taskId: "t1", subKpiId: "s1" },
				statusFrom: "open",
				statusTo: "met",
				prevHash: "0",
				chainHash: "x",
			},
		];
		expect(workspaceVelocity(events, null)).toEqual([]);
	});
});
