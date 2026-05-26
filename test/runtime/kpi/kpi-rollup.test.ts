import { describe, expect, it } from "vitest";

import { rollUpSubKpiReadings } from "../../../src/workspace/kpi-rollup";
import type { ProjectKpi, TaskSubKpi } from "../../../src/workspace/project-kpi";

const T = {
	t0: "2026-05-24T10:00:00.000Z",
	t1: "2026-05-24T11:00:00.000Z",
	t2: "2026-05-24T12:00:00.000Z",
};

function projectKpi(overrides: Partial<ProjectKpi> = {}): ProjectKpi {
	return {
		id: "kpi_a",
		label: "KPI A",
		target: { kind: "boolean" },
		acceptance: "auto-from-task",
		aggregate: "latest",
		readings: [],
		...overrides,
	};
}

function subKpi(overrides: Partial<TaskSubKpi> = {}): TaskSubKpi {
	return {
		id: "sub_a",
		parentKpiId: "kpi_a",
		label: "sub A",
		target: { kind: "boolean" },
		readings: [],
		...overrides,
	};
}

describe("rollUpSubKpiReadings", () => {
	it("returns parent KPIs unchanged when there are no contributions", () => {
		const parent = projectKpi();
		const result = rollUpSubKpiReadings({
			parentKpis: [parent],
			taskSubKpis: [],
			taskId: "t_one",
		});
		expect(result.parentKpis).toEqual([parent]);
		expect(result.appendedReadings.size).toBe(0);
	});

	it("ignores sub-KPIs without a parentKpiId", () => {
		const parent = projectKpi();
		const result = rollUpSubKpiReadings({
			parentKpis: [parent],
			taskSubKpis: [
				subKpi({
					parentKpiId: undefined,
					readings: [{ recordedAt: T.t0, source: "task", booleanValue: true }],
				}),
			],
			taskId: "t_one",
		});
		expect(result.appendedReadings.size).toBe(0);
		expect(result.parentKpis[0]!.readings).toEqual([]);
	});

	it("ignores sub-KPIs whose parentKpiId is unknown", () => {
		const parent = projectKpi({ id: "kpi_a" });
		const result = rollUpSubKpiReadings({
			parentKpis: [parent],
			taskSubKpis: [
				subKpi({
					parentKpiId: "kpi_other",
					readings: [{ recordedAt: T.t0, source: "task", booleanValue: true }],
				}),
			],
			taskId: "t_one",
		});
		expect(result.appendedReadings.size).toBe(0);
	});

	it("ignores parents whose acceptance is not auto-from-task", () => {
		const manual = projectKpi({ id: "kpi_manual", acceptance: "manual" });
		const validator = projectKpi({ id: "kpi_v", acceptance: "auto-from-validator" });
		const result = rollUpSubKpiReadings({
			parentKpis: [manual, validator],
			taskSubKpis: [
				subKpi({
					parentKpiId: "kpi_manual",
					readings: [{ recordedAt: T.t0, source: "task", booleanValue: true }],
				}),
				subKpi({
					parentKpiId: "kpi_v",
					readings: [{ recordedAt: T.t0, source: "task", booleanValue: true }],
				}),
			],
			taskId: "t_one",
		});
		expect(result.appendedReadings.size).toBe(0);
		expect(result.parentKpis[0]!.readings).toEqual([]);
		expect(result.parentKpis[1]!.readings).toEqual([]);
	});

	it("ignores sub-KPIs with no readings (agent didn't measure)", () => {
		const parent = projectKpi();
		const result = rollUpSubKpiReadings({
			parentKpis: [parent],
			taskSubKpis: [subKpi({ readings: [] })],
			taskId: "t_one",
		});
		expect(result.appendedReadings.size).toBe(0);
	});

	it("appends the latest reading rebranded as a task reading", () => {
		const parent = projectKpi({ target: { kind: "numeric", op: "<=", value: 200 } });
		const result = rollUpSubKpiReadings({
			parentKpis: [parent],
			taskSubKpis: [
				subKpi({
					target: { kind: "numeric", op: "<=", value: 200 },
					readings: [
						{ recordedAt: T.t0, source: "manual", numericValue: 250 },
						{ recordedAt: T.t2, source: "manual", numericValue: 178, note: "p99" },
						{ recordedAt: T.t1, source: "manual", numericValue: 190 },
					],
				}),
			],
			taskId: "t_perf01",
		});
		expect(result.appendedReadings.size).toBe(1);
		const appended = result.appendedReadings.get("kpi_a")!;
		expect(appended).toHaveLength(1);
		expect(appended[0]!.recordedAt).toBe(T.t2);
		expect(appended[0]!.numericValue).toBe(178);
		expect(appended[0]!.source).toBe("task");
		expect(appended[0]!.taskId).toBe("t_perf01");
		expect(appended[0]!.note).toBe("p99");
		expect(result.parentKpis[0]!.readings).toEqual(appended);
	});

	it("appends one reading per contributing sub-KPI for sum aggregation", () => {
		const parent = projectKpi({
			id: "six_checks",
			target: { kind: "numeric", op: ">=", value: 6 },
			aggregate: "sum",
		});
		const result = rollUpSubKpiReadings({
			parentKpis: [parent],
			taskSubKpis: [
				subKpi({
					id: "sub_five",
					parentKpiId: "six_checks",
					target: { kind: "numeric", op: "==", value: 5 },
					readings: [{ recordedAt: T.t0, source: "manual", numericValue: 5 }],
				}),
				subKpi({
					id: "sub_one",
					parentKpiId: "six_checks",
					target: { kind: "numeric", op: "==", value: 1 },
					readings: [{ recordedAt: T.t1, source: "manual", numericValue: 1 }],
				}),
			],
			taskId: "t_validator",
		});
		const appended = result.appendedReadings.get("six_checks")!;
		expect(appended).toHaveLength(2);
		expect(appended.map((r) => r.numericValue)).toEqual([5, 1]);
		expect(result.parentKpis[0]!.readings).toEqual(appended);
	});

	it("preserves parent KPI identity when no contribution applies", () => {
		const untouched = projectKpi({ id: "kpi_untouched", acceptance: "manual" });
		const touched = projectKpi({ id: "kpi_touched", acceptance: "auto-from-task" });
		const result = rollUpSubKpiReadings({
			parentKpis: [untouched, touched],
			taskSubKpis: [
				subKpi({
					id: "sub",
					parentKpiId: "kpi_touched",
					readings: [{ recordedAt: T.t0, source: "manual", booleanValue: true }],
				}),
			],
			taskId: "t_one",
		});
		expect(result.parentKpis[0]).toBe(untouched);
		expect(result.parentKpis[1]).not.toBe(touched);
		expect(result.parentKpis[1]!.readings).toHaveLength(1);
	});
});
