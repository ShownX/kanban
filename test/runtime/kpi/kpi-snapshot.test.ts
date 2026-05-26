import { describe, expect, it } from "vitest";

import { buildKpiSnapshot, formatSnapshotAsText } from "../../../src/workspace/kpi-snapshot";
import type { KpiStateFile } from "../../../src/workspace/kpi-state-file";
import type { ProjectKpi } from "../../../src/workspace/project-kpi";

const recordedAt = "2026-05-24T12:00:00.000Z";

function emptyState(): KpiStateFile {
	return { schemaVersion: 1, items: {}, tasks: {} };
}

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

describe("buildKpiSnapshot", () => {
	it("reports allMet=true with no blocking when the item has no KPIs", () => {
		const snapshot = buildKpiSnapshot({
			itemId: "item-1",
			definitions: [],
			state: emptyState(),
		});
		expect(snapshot.kpis).toEqual([]);
		expect(snapshot.allMet).toBe(true);
		expect(snapshot.blockingKpis).toEqual([]);
	});

	it("returns open when no readings exist", () => {
		const snapshot = buildKpiSnapshot({
			itemId: "item-1",
			definitions: [projectKpi({ id: "k1" })],
			state: emptyState(),
		});
		expect(snapshot.kpis[0]!.evaluation.status).toBe("open");
		expect(snapshot.allMet).toBe(false);
		expect(snapshot.blockingKpis).toEqual(["k1"]);
	});

	it("layers readings from the state file onto definitions", () => {
		const snapshot = buildKpiSnapshot({
			itemId: "item-1",
			definitions: [projectKpi({ id: "k1" })],
			state: {
				schemaVersion: 1,
				items: {
					"item-1": {
						kpis: { k1: { readings: [{ recordedAt, source: "manual", booleanValue: true }] } },
					},
				},
				tasks: {},
			},
		});
		expect(snapshot.kpis[0]!.evaluation.status).toBe("met");
		expect(snapshot.allMet).toBe(true);
	});

	it("counts waived as not blocking", () => {
		const snapshot = buildKpiSnapshot({
			itemId: "item-1",
			definitions: [projectKpi({ id: "k1" })],
			state: {
				schemaVersion: 1,
				items: {
					"item-1": {
						kpis: {
							k1: {
								readings: [],
								override: {
									status: "waived",
									reason: "out of scope",
									reviewer: "alice",
									decidedAt: recordedAt,
								},
							},
						},
					},
				},
				tasks: {},
			},
		});
		expect(snapshot.kpis[0]!.evaluation.status).toBe("waived");
		expect(snapshot.allMet).toBe(true);
		expect(snapshot.blockingKpis).toEqual([]);
	});

	it("identifies multiple blocking KPIs", () => {
		const snapshot = buildKpiSnapshot({
			itemId: "item-1",
			definitions: [
				projectKpi({ id: "k1", target: { kind: "boolean" } }),
				projectKpi({ id: "k2", target: { kind: "numeric", op: "<=", value: 200 } }),
				projectKpi({ id: "k3", target: { kind: "boolean" } }),
			],
			state: {
				schemaVersion: 1,
				items: {
					"item-1": {
						kpis: {
							k3: { readings: [{ recordedAt, source: "manual", booleanValue: true }] },
						},
					},
				},
				tasks: {},
			},
		});
		expect(snapshot.blockingKpis).toEqual(["k1", "k2"]);
		expect(snapshot.allMet).toBe(false);
	});
});

describe("formatSnapshotAsText", () => {
	it("renders a one-liner when no KPIs are declared", () => {
		const text = formatSnapshotAsText(buildKpiSnapshot({ itemId: "item-1", definitions: [], state: emptyState() }));
		expect(text).toBe("item-1: no KPIs declared");
	});

	it("includes the rollup line and one line per KPI", () => {
		const text = formatSnapshotAsText(
			buildKpiSnapshot({
				itemId: "item-1",
				definitions: [
					projectKpi({ id: "k1", target: { kind: "numeric", op: "<=", value: 200, unit: "ms" } }),
					projectKpi({ id: "k2", target: { kind: "boolean" } }),
				],
				state: {
					schemaVersion: 1,
					items: {
						"item-1": {
							kpis: {
								k1: { readings: [{ recordedAt, source: "manual", numericValue: 178 }] },
							},
						},
					},
					tasks: {},
				},
			}),
		);
		expect(text).toContain("item-1: 1/2 met, 1 open");
		expect(text).toContain("k1 [met] target=<=200ms value=178");
		expect(text).toContain("k2 [open] target=boolean value=no readings");
	});
});
