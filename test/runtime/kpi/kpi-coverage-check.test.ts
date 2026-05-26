import { describe, expect, it } from "vitest";

import { checkKpiCoverage } from "../../../src/workspace/kpi-coverage-check";
import type { ProjectKpi, TaskSubKpi } from "../../../src/workspace/project-kpi";

const recordedAt = "2026-05-24T12:00:00.000Z";

function projectKpi(overrides: Partial<ProjectKpi> = {}): ProjectKpi {
	return {
		id: "kpi_a",
		label: "KPI A",
		target: { kind: "boolean" },
		acceptance: "manual",
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

describe("checkKpiCoverage", () => {
	it("passes vacuously when no KPIs are declared", () => {
		const result = checkKpiCoverage({ itemKpis: [], linkedSubKpis: [] });
		expect(result.status).toBe("pass");
		expect(result.missingKpiIds).toEqual([]);
		expect(result.deferredKpiIds).toEqual([]);
	});

	it("skips manual KPIs entirely", () => {
		const result = checkKpiCoverage({
			itemKpis: [projectKpi({ acceptance: "manual" })],
			linkedSubKpis: [],
		});
		expect(result.status).toBe("pass");
		expect(result.missingKpiIds).toEqual([]);
		expect(result.deferredKpiIds).toEqual([]);
	});

	it("defers auto-from-validator KPIs and surfaces them in details", () => {
		const result = checkKpiCoverage({
			itemKpis: [
				projectKpi({ id: "p99_latency", acceptance: "auto-from-validator" }),
				projectKpi({ id: "rollback_runbook", acceptance: "manual" }),
			],
			linkedSubKpis: [],
		});
		expect(result.status).toBe("pass");
		expect(result.missingKpiIds).toEqual([]);
		expect(result.deferredKpiIds).toEqual(["p99_latency"]);
		expect(result.details).toContain("Deferred to Phase C");
		expect(result.details).toContain("p99_latency");
	});

	it("flags an auto-from-task KPI with no contributing sub-KPI as needs_review", () => {
		const result = checkKpiCoverage({
			itemKpis: [projectKpi({ id: "kpi_a", acceptance: "auto-from-task" })],
			linkedSubKpis: [],
		});
		expect(result.status).toBe("needs_review");
		expect(result.missingKpiIds).toEqual(["kpi_a"]);
	});

	it("flags an auto-from-task KPI when sub-KPIs exist but none have readings", () => {
		const result = checkKpiCoverage({
			itemKpis: [projectKpi({ id: "kpi_a", acceptance: "auto-from-task" })],
			linkedSubKpis: [subKpi({ readings: [] })],
		});
		expect(result.status).toBe("needs_review");
		expect(result.missingKpiIds).toEqual(["kpi_a"]);
	});

	it("flags an auto-from-task KPI when matching sub-KPI exists for a different parent", () => {
		const result = checkKpiCoverage({
			itemKpis: [projectKpi({ id: "kpi_a", acceptance: "auto-from-task" })],
			linkedSubKpis: [
				subKpi({
					parentKpiId: "kpi_b",
					readings: [{ recordedAt, source: "task", booleanValue: true }],
				}),
			],
		});
		expect(result.status).toBe("needs_review");
		expect(result.missingKpiIds).toEqual(["kpi_a"]);
	});

	it("ignores sub-KPIs without a parentKpiId (informational)", () => {
		const result = checkKpiCoverage({
			itemKpis: [projectKpi({ id: "kpi_a", acceptance: "auto-from-task" })],
			linkedSubKpis: [
				{
					id: "informational",
					label: "info",
					target: { kind: "boolean" },
					readings: [{ recordedAt, source: "task", booleanValue: true }],
				},
			],
		});
		expect(result.status).toBe("needs_review");
		expect(result.missingKpiIds).toEqual(["kpi_a"]);
	});

	it("passes when every auto-from-task KPI has at least one reading from a matching sub-KPI", () => {
		const result = checkKpiCoverage({
			itemKpis: [projectKpi({ id: "kpi_a", acceptance: "auto-from-task" })],
			linkedSubKpis: [
				subKpi({
					parentKpiId: "kpi_a",
					readings: [{ recordedAt, source: "task", booleanValue: true }],
				}),
			],
		});
		expect(result.status).toBe("pass");
		expect(result.missingKpiIds).toEqual([]);
	});

	it("collects multiple missing ids in declaration order", () => {
		const result = checkKpiCoverage({
			itemKpis: [
				projectKpi({ id: "alpha", acceptance: "auto-from-task" }),
				projectKpi({ id: "beta", acceptance: "auto-from-task" }),
				projectKpi({ id: "gamma", acceptance: "auto-from-task" }),
			],
			linkedSubKpis: [
				subKpi({
					parentKpiId: "beta",
					readings: [{ recordedAt, source: "task", booleanValue: true }],
				}),
			],
		});
		expect(result.status).toBe("needs_review");
		expect(result.missingKpiIds).toEqual(["alpha", "gamma"]);
		expect(result.details).toContain("alpha");
		expect(result.details).toContain("gamma");
	});

	it("mixes missing and deferred in details when both present", () => {
		const result = checkKpiCoverage({
			itemKpis: [
				projectKpi({ id: "alpha", acceptance: "auto-from-task" }),
				projectKpi({ id: "beta", acceptance: "auto-from-validator" }),
			],
			linkedSubKpis: [],
		});
		expect(result.status).toBe("needs_review");
		expect(result.missingKpiIds).toEqual(["alpha"]);
		expect(result.deferredKpiIds).toEqual(["beta"]);
		expect(result.details).toContain("Missing readings");
		expect(result.details).toContain("Deferred to Phase C");
	});
});
