import { describe, expect, it } from "vitest";

import type { KpiEvent } from "../../../src/workspace/kpi-event-log";
import { kpiBurndown, kpiCycleTime, kpiRegressions, kpiVelocity } from "../../../src/workspace/kpi-history";

const ITEM = "roadmap_demo";

function project(kpiId: string, base: Partial<KpiEvent> = {}): KpiEvent {
	return {
		seq: 1,
		ts: "2026-05-28T12:00:00.000Z",
		type: "status_changed",
		scope: { kind: "project", itemId: ITEM, kpiId },
		prevHash: "0",
		chainHash: "x",
		...base,
	} as KpiEvent;
}

describe("kpiBurndown", () => {
	it("returns an empty list when there are no transitions", () => {
		expect(kpiBurndown([], ITEM)).toEqual([]);
	});

	it("plots one point per transition with running met count", () => {
		const events: KpiEvent[] = [
			project("a", { ts: "2026-05-28T10:00:00.000Z", type: "reading_appended", seq: 1 }),
			project("a", {
				ts: "2026-05-28T10:00:01.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 2,
			}),
			project("b", { ts: "2026-05-28T11:00:00.000Z", type: "reading_appended", seq: 3 }),
			project("b", {
				ts: "2026-05-28T11:00:01.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "missed",
				seq: 4,
			}),
			project("b", {
				ts: "2026-05-28T12:00:00.000Z",
				type: "status_changed",
				statusFrom: "missed",
				statusTo: "met",
				seq: 5,
			}),
		];
		const points = kpiBurndown(events, ITEM);
		expect(points).toHaveLength(3);
		expect(points[0]).toMatchObject({ totalKpis: 2, metKpis: 1 });
		expect(points[1]).toMatchObject({ totalKpis: 2, metKpis: 1 });
		expect(points[2]).toMatchObject({ totalKpis: 2, metKpis: 2 });
	});

	it("counts waived as met for the rollup", () => {
		const events: KpiEvent[] = [
			project("a", { ts: "2026-05-28T10:00:00.000Z", type: "reading_appended", seq: 1 }),
			project("a", {
				ts: "2026-05-28T10:00:01.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "waived",
				seq: 2,
			}),
		];
		const points = kpiBurndown(events, ITEM);
		expect(points[0]?.metKpis).toBe(1);
	});

	it("ignores transitions for other items", () => {
		const events: KpiEvent[] = [
			project("a", {
				ts: "2026-05-28T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				scope: { kind: "project", itemId: "other_item", kpiId: "a" },
				seq: 1,
			}),
		];
		expect(kpiBurndown(events, ITEM)).toEqual([]);
	});
});

describe("kpiVelocity", () => {
	it("buckets met-flips per day", () => {
		const events: KpiEvent[] = [
			project("a", {
				ts: "2026-05-26T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 1,
			}),
			project("b", {
				ts: "2026-05-26T20:00:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 2,
			}),
			project("c", {
				ts: "2026-05-27T08:00:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 3,
			}),
		];
		const buckets = kpiVelocity(events, ITEM, null);
		expect(buckets).toEqual([
			{ day: "2026-05-26", metCount: 2 },
			{ day: "2026-05-27", metCount: 1 },
		]);
	});

	it("ignores transitions that re-confirm met (statusFrom: met)", () => {
		const events: KpiEvent[] = [
			project("a", {
				ts: "2026-05-26T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "met",
				statusTo: "met",
				seq: 1,
			}),
		];
		expect(kpiVelocity(events, ITEM, null)).toEqual([]);
	});
});

describe("kpiCycleTime", () => {
	it("computes minutes from first reading to first met per KPI", () => {
		const events: KpiEvent[] = [
			project("a", { ts: "2026-05-28T10:00:00.000Z", type: "reading_appended", seq: 1 }),
			project("a", {
				ts: "2026-05-28T10:30:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 2,
			}),
		];
		const out = kpiCycleTime(events, ITEM);
		expect(out).toEqual([expect.objectContaining({ kpiId: "a", minutes: 30 })]);
	});

	it("omits KPIs that haven't reached met", () => {
		const events: KpiEvent[] = [project("a", { ts: "2026-05-28T10:00:00.000Z", type: "reading_appended", seq: 1 })];
		expect(kpiCycleTime(events, ITEM)).toEqual([]);
	});

	it("uses the FIRST reading and FIRST met (later cycles ignored)", () => {
		const events: KpiEvent[] = [
			project("a", { ts: "2026-05-28T10:00:00.000Z", type: "reading_appended", seq: 1 }),
			project("a", {
				ts: "2026-05-28T10:30:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 2,
			}),
			project("a", { ts: "2026-05-29T10:00:00.000Z", type: "reading_appended", seq: 3 }),
			project("a", {
				ts: "2026-05-29T10:05:00.000Z",
				type: "status_changed",
				statusFrom: "missed",
				statusTo: "met",
				seq: 4,
			}),
		];
		const out = kpiCycleTime(events, ITEM);
		expect(out[0]?.minutes).toBe(30);
	});
});

describe("kpiRegressions", () => {
	it("returns met -> missed transitions newest-first", () => {
		const events: KpiEvent[] = [
			project("a", {
				ts: "2026-05-26T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "met",
				statusTo: "missed",
				seq: 1,
			}),
			project("b", {
				ts: "2026-05-28T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "met",
				statusTo: "missed",
				seq: 2,
			}),
			project("c", {
				ts: "2026-05-27T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 3,
			}),
		];
		const regressions = kpiRegressions(events, ITEM);
		expect(regressions).toHaveLength(2);
		expect(regressions[0]?.kpiId).toBe("b");
		expect(regressions[1]?.kpiId).toBe("a");
	});

	it("ignores non-regression transitions", () => {
		const events: KpiEvent[] = [
			project("a", {
				ts: "2026-05-28T10:00:00.000Z",
				type: "status_changed",
				statusFrom: "open",
				statusTo: "met",
				seq: 1,
			}),
		];
		expect(kpiRegressions(events, ITEM)).toEqual([]);
	});
});
