import { describe, expect, it } from "vitest";

import {
	formatPrometheusMetrics,
	type PrometheusFormatInput,
	sanitizeWorkspaceLabel,
} from "../../../src/workspace/kpi-prometheus-format";
import type { KpiSnapshot } from "../../../src/workspace/kpi-snapshot";
import type { ProjectKpi } from "../../../src/workspace/project-kpi";

function snapshot(
	itemId: string,
	entries: Array<{
		kpi: ProjectKpi;
		status: KpiSnapshot["kpis"][number]["evaluation"]["status"];
		value?: number | boolean | string;
	}>,
): KpiSnapshot {
	const kpis = entries.map(({ kpi, status, value }) => ({
		definition: kpi,
		evaluation: {
			status,
			aggregatedValue: value === undefined ? null : value,
			contributingReadings: [],
			warnings: [],
		},
	}));
	const blocking = entries.filter((e) => e.status !== "met" && e.status !== "waived").map((e) => e.kpi.id);
	return { itemId, kpis, allMet: blocking.length === 0, blockingKpis: blocking };
}

function projectKpi(
	id: string,
	target: ProjectKpi["target"],
	acceptance: ProjectKpi["acceptance"] = "manual",
): ProjectKpi {
	return { id, label: id, target, acceptance, aggregate: "latest", readings: [] };
}

const EMPTY_SUMMARY = {
	totalItems: 0,
	totalKpis: 0,
	metKpis: 0,
	regressionCount: 0,
	blockedItemIds: [],
};

describe("formatPrometheusMetrics", () => {
	it("emits HELP/TYPE headers and gauges for each metric family", () => {
		const text = formatPrometheusMetrics({
			workspace: "demo",
			perItem: [
				{
					itemId: "roadmap_perf01",
					snapshot: snapshot("roadmap_perf01", [
						{
							kpi: projectKpi(
								"p99_latency",
								{ kind: "numeric", op: "<=", value: 200, unit: "ms" },
								"auto-from-task",
							),
							status: "met",
							value: 178,
						},
					]),
					readingCounts: new Map([["p99_latency", 3]]),
				},
			],
			workspaceSummary: {
				totalItems: 1,
				totalKpis: 1,
				metKpis: 1,
				regressionCount: 0,
				blockedItemIds: [],
			},
			oldestOpen: [],
		});

		expect(text).toContain("# HELP kanban_kpi_status");
		expect(text).toContain("# TYPE kanban_kpi_status gauge");
		expect(text).toMatch(
			/kanban_kpi_status\{acceptance="auto-from-task",kpi_id="p99_latency",roadmap_item="roadmap_perf01",workspace="demo"\} 1/,
		);
		expect(text).toContain("# TYPE kanban_kpi_value gauge");
		expect(text).toMatch(/kanban_kpi_value\{[^}]*\} 178/);
		expect(text).toContain("# TYPE kanban_kpi_readings_total counter");
		expect(text).toMatch(/kanban_kpi_readings_total\{[^}]*\} 3/);
		expect(text).toContain('kanban_kpi_workspace_total{workspace="demo"} 1');
		expect(text).toContain('kanban_kpi_workspace_met{workspace="demo"} 1');
		expect(text.endsWith("\n")).toBe(true);
	});

	it("maps every status to its enum code", () => {
		const cases: Array<{ status: KpiSnapshot["kpis"][number]["evaluation"]["status"]; code: number }> = [
			{ status: "open", code: 0 },
			{ status: "met", code: 1 },
			{ status: "missed", code: 2 },
			{ status: "waived", code: 3 },
		];
		for (const { status, code } of cases) {
			const text = formatPrometheusMetrics({
				workspace: "demo",
				perItem: [
					{
						itemId: "i",
						snapshot: snapshot("i", [{ kpi: projectKpi("k", { kind: "boolean" }), status }]),
						readingCounts: new Map(),
					},
				],
				workspaceSummary: EMPTY_SUMMARY,
				oldestOpen: [],
			});
			expect(text).toMatch(new RegExp(`kanban_kpi_status\\{[^}]*kpi_id="k"[^}]*\\} ${code}`));
		}
	});

	it("omits kanban_kpi_value rows for boolean and rubric KPIs", () => {
		const text = formatPrometheusMetrics({
			workspace: "demo",
			perItem: [
				{
					itemId: "i",
					snapshot: snapshot("i", [
						{ kpi: projectKpi("flag", { kind: "boolean" }), status: "met", value: true },
						{
							kpi: projectKpi("dx", { kind: "rubric", levels: ["bad", "ok", "good"], minimum: "good" }),
							status: "met",
							value: "good",
						},
					]),
					readingCounts: new Map(),
				},
			],
			workspaceSummary: EMPTY_SUMMARY,
			oldestOpen: [],
		});
		expect(text).not.toContain("kanban_kpi_value");
	});

	it("escapes backslash and quote characters in label values", () => {
		const text = formatPrometheusMetrics({
			workspace: 'has"quote',
			perItem: [
				{
					itemId: "weird\\path",
					snapshot: snapshot("weird\\path", [{ kpi: projectKpi("k", { kind: "boolean" }), status: "open" }]),
					readingCounts: new Map(),
				},
			],
			workspaceSummary: EMPTY_SUMMARY,
			oldestOpen: [],
		});
		// Backslash escaped to \\, quote escaped to \"
		expect(text).toContain('workspace="has\\"quote"');
		expect(text).toContain('roadmap_item="weird\\\\path"');
	});

	it("orders rows deterministically by (item, kpi)", () => {
		const text = formatPrometheusMetrics({
			workspace: "demo",
			perItem: [
				{
					itemId: "z_item",
					snapshot: snapshot("z_item", [
						{ kpi: projectKpi("z_kpi", { kind: "boolean" }), status: "open" },
						{ kpi: projectKpi("a_kpi", { kind: "boolean" }), status: "open" },
					]),
					readingCounts: new Map(),
				},
				{
					itemId: "a_item",
					snapshot: snapshot("a_item", [{ kpi: projectKpi("a_kpi", { kind: "boolean" }), status: "open" }]),
					readingCounts: new Map(),
				},
			],
			workspaceSummary: EMPTY_SUMMARY,
			oldestOpen: [],
		});
		const statusLines = text.split("\n").filter((l) => l.startsWith("kanban_kpi_status"));
		const order = statusLines.map((l) => {
			const item = l.match(/roadmap_item="([^"]+)"/)?.[1];
			const kpi = l.match(/kpi_id="([^"]+)"/)?.[1];
			return `${item}/${kpi}`;
		});
		expect(order).toEqual(["a_item/a_kpi", "z_item/a_kpi", "z_item/z_kpi"]);
	});

	it("emits oldest-open rows sorted by (item, kpi)", () => {
		const text = formatPrometheusMetrics({
			workspace: "demo",
			perItem: [],
			workspaceSummary: EMPTY_SUMMARY,
			oldestOpen: [
				{ roadmapItemId: "z", kpiId: "k", openedAt: "2026-04-01", daysOpen: 47 },
				{ roadmapItemId: "a", kpiId: "k", openedAt: "2026-04-15", daysOpen: 33 },
			],
		});
		expect(text).toContain("# TYPE kanban_kpi_oldest_open_days gauge");
		const lines = text.split("\n").filter((l) => l.startsWith("kanban_kpi_oldest_open_days"));
		expect(lines[0]).toContain('roadmap_item="a"');
		expect(lines[1]).toContain('roadmap_item="z"');
		expect(lines[1]).toContain(" 47");
	});

	it("is byte-identical for identical input (deterministic)", () => {
		const buildInput = (): PrometheusFormatInput => ({
			workspace: "demo",
			perItem: [
				{
					itemId: "i",
					snapshot: snapshot("i", [
						{
							kpi: projectKpi("k", { kind: "numeric", op: ">=", value: 5 }),
							status: "met",
							value: 7,
						},
					]),
					readingCounts: new Map([["k", 2]]),
				},
			],
			workspaceSummary: { totalItems: 1, totalKpis: 1, metKpis: 1, regressionCount: 0, blockedItemIds: [] },
			oldestOpen: [],
		});
		expect(formatPrometheusMetrics(buildInput())).toBe(formatPrometheusMetrics(buildInput()));
	});
});

describe("sanitizeWorkspaceLabel", () => {
	it("lowercases and replaces non-alphanumerics with underscores", () => {
		expect(sanitizeWorkspaceLabel("My Project")).toBe("my_project");
		expect(sanitizeWorkspaceLabel("foo/bar.baz")).toBe("foo_bar_baz");
	});

	it("strips leading and trailing underscores", () => {
		expect(sanitizeWorkspaceLabel("__foo__")).toBe("foo");
	});

	it("falls back to 'kanban' for an empty input", () => {
		expect(sanitizeWorkspaceLabel("")).toBe("kanban");
		expect(sanitizeWorkspaceLabel("///")).toBe("kanban");
	});
});
