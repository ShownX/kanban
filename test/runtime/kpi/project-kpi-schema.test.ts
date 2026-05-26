import { describe, expect, it } from "vitest";

import {
	kpiAggregateSchema,
	kpiReadingSchema,
	kpiTargetSchema,
	projectKpiSchema,
	taskSubKpiSchema,
} from "../../../src/workspace/project-kpi";

describe("kpiTargetSchema", () => {
	it("accepts a boolean target", () => {
		expect(kpiTargetSchema.safeParse({ kind: "boolean" }).success).toBe(true);
	});

	it("accepts a numeric target with op + value + unit", () => {
		const ok = kpiTargetSchema.safeParse({ kind: "numeric", op: "<=", value: 200, unit: "ms" });
		expect(ok.success).toBe(true);
	});

	it("rejects numeric op outside the enum", () => {
		const bad = kpiTargetSchema.safeParse({ kind: "numeric", op: "≈", value: 100 });
		expect(bad.success).toBe(false);
	});

	it("accepts a rubric target with at least 2 levels and a minimum", () => {
		const ok = kpiTargetSchema.safeParse({
			kind: "rubric",
			levels: ["bad", "ok", "good", "great"],
			minimum: "good",
		});
		expect(ok.success).toBe(true);
	});

	it("rejects rubric with a single level", () => {
		const bad = kpiTargetSchema.safeParse({ kind: "rubric", levels: ["only"], minimum: "only" });
		expect(bad.success).toBe(false);
	});
});

describe("kpiAggregateSchema", () => {
	it("accepts each defined value", () => {
		for (const value of ["latest", "sum", "min", "max", "all-must-meet"]) {
			expect(kpiAggregateSchema.safeParse(value).success).toBe(true);
		}
	});

	it("rejects unknown values", () => {
		expect(kpiAggregateSchema.safeParse("avg").success).toBe(false);
	});
});

describe("kpiReadingSchema", () => {
	it("accepts a numeric reading from a task", () => {
		const ok = kpiReadingSchema.safeParse({
			recordedAt: "2026-05-24T12:00:00.000Z",
			source: "task",
			taskId: "t_validator01",
			numericValue: 5,
			note: "five checks",
		});
		expect(ok.success).toBe(true);
	});

	it("accepts a boolean manual reading", () => {
		const ok = kpiReadingSchema.safeParse({
			recordedAt: "2026-05-24T12:00:00.000Z",
			source: "manual",
			booleanValue: true,
		});
		expect(ok.success).toBe(true);
	});
});

describe("projectKpiSchema", () => {
	it("defaults acceptance to manual and aggregate to latest", () => {
		const parsed = projectKpiSchema.parse({
			id: "rollback_runbook",
			label: "Rollback runbook published",
			target: { kind: "boolean" },
		});
		expect(parsed.acceptance).toBe("manual");
		expect(parsed.aggregate).toBe("latest");
		expect(parsed.readings).toEqual([]);
	});

	it("accepts every override status", () => {
		for (const status of ["open", "met", "missed", "waived"] as const) {
			const ok = projectKpiSchema.safeParse({
				id: "k",
				label: "k",
				target: { kind: "boolean" },
				override: {
					status,
					reason: "because",
					reviewer: "alice",
					decidedAt: "2026-05-24T12:00:00.000Z",
				},
			});
			expect(ok.success).toBe(true);
		}
	});
});

describe("taskSubKpiSchema", () => {
	it("accepts a sub-KPI without a parentKpiId (informational)", () => {
		const ok = taskSubKpiSchema.safeParse({
			id: "sub",
			label: "anything",
			target: { kind: "boolean" },
		});
		expect(ok.success).toBe(true);
	});

	it("preserves parentKpiId when provided", () => {
		const parsed = taskSubKpiSchema.parse({
			id: "sub",
			parentKpiId: "six_checks",
			label: "checks implemented",
			target: { kind: "numeric", op: "==", value: 5 },
		});
		expect(parsed.parentKpiId).toBe("six_checks");
	});
});
