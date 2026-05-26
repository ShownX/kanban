import { describe, expect, it } from "vitest";

import { evaluateProjectKpi, evaluateTaskSubKpi } from "../../../src/workspace/kpi-engine";
import type { KpiReading, ProjectKpi } from "../../../src/workspace/project-kpi";

const T = {
	t0: "2026-05-24T10:00:00.000Z",
	t1: "2026-05-24T11:00:00.000Z",
	t2: "2026-05-24T12:00:00.000Z",
	t3: "2026-05-24T13:00:00.000Z",
};

function baseKpi(overrides: Partial<ProjectKpi> = {}): ProjectKpi {
	return {
		id: "k",
		label: "k",
		target: { kind: "boolean" },
		acceptance: "manual",
		aggregate: "latest",
		readings: [],
		...overrides,
	};
}

describe("evaluateProjectKpi — override wins", () => {
	it("returns the override status, ignoring readings", () => {
		const kpi = baseKpi({
			override: {
				status: "waived",
				reason: "out of scope this quarter",
				reviewer: "alice",
				decidedAt: T.t2,
			},
			readings: [{ recordedAt: T.t1, source: "manual", booleanValue: false }],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("waived");
		expect(result.aggregatedValue).toBeNull();
		expect(result.contributingReadings).toEqual([]);
	});
});

describe("evaluateProjectKpi — source filtering by acceptance", () => {
	it("manual acceptance only counts manual readings", () => {
		const kpi = baseKpi({
			acceptance: "manual",
			readings: [
				{ recordedAt: T.t1, source: "task", booleanValue: true },
				{ recordedAt: T.t2, source: "manual", booleanValue: false },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("missed");
		expect(result.aggregatedValue).toBe(false);
		expect(result.contributingReadings).toHaveLength(1);
		expect(result.contributingReadings[0]!.source).toBe("manual");
	});

	it("auto-from-task acceptance only counts task readings", () => {
		const kpi = baseKpi({
			acceptance: "auto-from-task",
			readings: [
				{ recordedAt: T.t1, source: "manual", booleanValue: false },
				{ recordedAt: T.t2, source: "task", booleanValue: true },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
	});

	it("auto-from-validator acceptance only counts validator readings", () => {
		const kpi = baseKpi({
			acceptance: "auto-from-validator",
			readings: [
				{ recordedAt: T.t1, source: "task", booleanValue: true },
				{ recordedAt: T.t2, source: "validator", booleanValue: true },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
		expect(result.contributingReadings).toHaveLength(1);
		expect(result.contributingReadings[0]!.source).toBe("validator");
	});

	it("returns open when no readings match the source", () => {
		const kpi = baseKpi({
			acceptance: "auto-from-task",
			readings: [{ recordedAt: T.t1, source: "manual", booleanValue: true }],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("open");
		expect(result.aggregatedValue).toBeNull();
	});

	it("returns open when there are no readings at all", () => {
		const result = evaluateProjectKpi(baseKpi());
		expect(result.status).toBe("open");
	});
});

describe("evaluateProjectKpi — aggregation policy", () => {
	it("latest picks the newest reading regardless of insertion order", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: "<=", value: 200 },
			acceptance: "manual",
			aggregate: "latest",
			readings: [
				{ recordedAt: T.t2, source: "manual", numericValue: 150 },
				{ recordedAt: T.t0, source: "manual", numericValue: 500 },
				{ recordedAt: T.t1, source: "manual", numericValue: 300 },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
		expect(result.aggregatedValue).toBe(150);
		expect(result.contributingReadings.map((r) => r.recordedAt)).toEqual([T.t2, T.t1, T.t0]);
	});

	it("sum adds numeric readings and checks the total", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: ">=", value: 10 },
			acceptance: "auto-from-task",
			aggregate: "sum",
			readings: [
				{ recordedAt: T.t0, source: "task", numericValue: 4 },
				{ recordedAt: T.t1, source: "task", numericValue: 5 },
				{ recordedAt: T.t2, source: "task", numericValue: 3 },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
		expect(result.aggregatedValue).toBe(12);
	});

	it("sum on a non-numeric target falls back to latest with a warning", () => {
		const kpi = baseKpi({
			target: { kind: "boolean" },
			acceptance: "manual",
			aggregate: "sum",
			readings: [
				{ recordedAt: T.t0, source: "manual", booleanValue: false },
				{ recordedAt: T.t1, source: "manual", booleanValue: true },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
		expect(result.aggregatedValue).toBe(true);
		expect(result.warnings.some((w) => w.includes('"sum"'))).toBe(true);
	});

	it("min picks the lowest numeric value", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: ">=", value: 90 },
			acceptance: "manual",
			aggregate: "min",
			readings: [
				{ recordedAt: T.t0, source: "manual", numericValue: 95 },
				{ recordedAt: T.t1, source: "manual", numericValue: 80 },
				{ recordedAt: T.t2, source: "manual", numericValue: 100 },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("missed");
		expect(result.aggregatedValue).toBe(80);
	});

	it("max picks the highest numeric value", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: ">=", value: 90 },
			acceptance: "manual",
			aggregate: "max",
			readings: [
				{ recordedAt: T.t0, source: "manual", numericValue: 50 },
				{ recordedAt: T.t1, source: "manual", numericValue: 95 },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
		expect(result.aggregatedValue).toBe(95);
	});

	it("min on rubric picks the worst level", () => {
		const kpi = baseKpi({
			target: {
				kind: "rubric",
				levels: ["bad", "ok", "good", "great"],
				minimum: "good",
			},
			acceptance: "manual",
			aggregate: "min",
			readings: [
				{ recordedAt: T.t0, source: "manual", rubricValue: "great" },
				{ recordedAt: T.t1, source: "manual", rubricValue: "ok" },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.aggregatedValue).toBe("ok");
		expect(result.status).toBe("missed");
	});

	it("max on rubric picks the best level", () => {
		const kpi = baseKpi({
			target: {
				kind: "rubric",
				levels: ["bad", "ok", "good", "great"],
				minimum: "good",
			},
			acceptance: "manual",
			aggregate: "max",
			readings: [
				{ recordedAt: T.t0, source: "manual", rubricValue: "ok" },
				{ recordedAt: T.t1, source: "manual", rubricValue: "great" },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.aggregatedValue).toBe("great");
		expect(result.status).toBe("met");
	});

	it("min on boolean is logical AND", () => {
		const kpi = baseKpi({
			target: { kind: "boolean" },
			acceptance: "manual",
			aggregate: "min",
			readings: [
				{ recordedAt: T.t0, source: "manual", booleanValue: true },
				{ recordedAt: T.t1, source: "manual", booleanValue: false },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.aggregatedValue).toBe(false);
		expect(result.status).toBe("missed");
	});

	it("max on boolean is logical OR", () => {
		const kpi = baseKpi({
			target: { kind: "boolean" },
			acceptance: "manual",
			aggregate: "max",
			readings: [
				{ recordedAt: T.t0, source: "manual", booleanValue: false },
				{ recordedAt: T.t1, source: "manual", booleanValue: true },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.aggregatedValue).toBe(true);
		expect(result.status).toBe("met");
	});

	it("all-must-meet returns met only when every reading passes the target", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: "<=", value: 200 },
			acceptance: "manual",
			aggregate: "all-must-meet",
			readings: [
				{ recordedAt: T.t0, source: "manual", numericValue: 150 },
				{ recordedAt: T.t1, source: "manual", numericValue: 199 },
				{ recordedAt: T.t2, source: "manual", numericValue: 180 },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("met");
	});

	it("all-must-meet returns missed when any reading fails the target", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: "<=", value: 200 },
			acceptance: "manual",
			aggregate: "all-must-meet",
			readings: [
				{ recordedAt: T.t0, source: "manual", numericValue: 150 },
				{ recordedAt: T.t1, source: "manual", numericValue: 250 },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("missed");
	});

	it("all-must-meet on boolean surfaces the AND result", () => {
		const kpi = baseKpi({
			target: { kind: "boolean" },
			acceptance: "manual",
			aggregate: "all-must-meet",
			readings: [
				{ recordedAt: T.t0, source: "manual", booleanValue: true },
				{ recordedAt: T.t1, source: "manual", booleanValue: false },
			],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("missed");
		expect(result.aggregatedValue).toBe(false);
	});
});

describe("evaluateProjectKpi — target checking", () => {
	it("numeric >= passes when value meets the threshold", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: ">=", value: 100 },
			readings: [{ recordedAt: T.t0, source: "manual", numericValue: 100 }],
		});
		expect(evaluateProjectKpi(kpi).status).toBe("met");
	});

	it("numeric > is strict", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: ">", value: 100 },
			readings: [{ recordedAt: T.t0, source: "manual", numericValue: 100 }],
		});
		expect(evaluateProjectKpi(kpi).status).toBe("missed");
	});

	it("numeric < is strict", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: "<", value: 100 },
			readings: [{ recordedAt: T.t0, source: "manual", numericValue: 100 }],
		});
		expect(evaluateProjectKpi(kpi).status).toBe("missed");
	});

	it("numeric == requires equality", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: "==", value: 5 },
			readings: [{ recordedAt: T.t0, source: "manual", numericValue: 5 }],
		});
		expect(evaluateProjectKpi(kpi).status).toBe("met");
	});

	it("rubric meets when value level is at or above minimum", () => {
		const kpi = baseKpi({
			target: { kind: "rubric", levels: ["bad", "ok", "good", "great"], minimum: "good" },
			readings: [{ recordedAt: T.t0, source: "manual", rubricValue: "good" }],
		});
		expect(evaluateProjectKpi(kpi).status).toBe("met");
	});

	it("rubric misses when value level is below minimum", () => {
		const kpi = baseKpi({
			target: { kind: "rubric", levels: ["bad", "ok", "good", "great"], minimum: "good" },
			readings: [{ recordedAt: T.t0, source: "manual", rubricValue: "ok" }],
		});
		expect(evaluateProjectKpi(kpi).status).toBe("missed");
	});

	it("rubric reading not in the levels list is ignored as incompatible", () => {
		const kpi = baseKpi({
			target: { kind: "rubric", levels: ["bad", "ok", "good", "great"], minimum: "good" },
			readings: [{ recordedAt: T.t0, source: "manual", rubricValue: "amazing" }],
		});
		// `amazing` matches the kind (string), so it surfaces — but it's not in the
		// levels map, so checkTarget returns false.
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("missed");
	});

	it("warns when readings exist but none match the target kind", () => {
		const kpi = baseKpi({
			target: { kind: "numeric", op: "<=", value: 200 },
			readings: [{ recordedAt: T.t0, source: "manual", booleanValue: true }],
		});
		const result = evaluateProjectKpi(kpi);
		expect(result.status).toBe("open");
		expect(result.warnings.some((w) => w.includes("numeric"))).toBe(true);
	});
});

describe("evaluateTaskSubKpi", () => {
	it("returns open when there are no readings", () => {
		const result = evaluateTaskSubKpi({
			target: { kind: "boolean" },
			readings: [],
		});
		expect(result.status).toBe("open");
	});

	it("uses latest-wins regardless of source", () => {
		const readings: KpiReading[] = [
			{ recordedAt: T.t0, source: "task", numericValue: 1 },
			{ recordedAt: T.t1, source: "manual", numericValue: 5 },
			{ recordedAt: T.t2, source: "validator", numericValue: 3 },
		];
		const result = evaluateTaskSubKpi({
			target: { kind: "numeric", op: ">=", value: 3 },
			readings,
		});
		expect(result.status).toBe("met");
		expect(result.aggregatedValue).toBe(3);
	});

	it("returns missed when latest reading fails the target", () => {
		const result = evaluateTaskSubKpi({
			target: { kind: "numeric", op: ">=", value: 5 },
			readings: [
				{ recordedAt: T.t0, source: "task", numericValue: 10 },
				{ recordedAt: T.t1, source: "task", numericValue: 2 },
			],
		});
		expect(result.status).toBe("missed");
		expect(result.aggregatedValue).toBe(2);
	});
});
