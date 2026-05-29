/**
 * Render KPI state as Prometheus exposition format text.
 *
 * Pure function. Caller assembles the input from the existing snapshot
 * + workspace-history helpers; this module is responsible only for the
 * stringification + label escaping + deterministic ordering.
 *
 * See `.plan/docs/kpi-tracking-phase-e.md` for the metric schema.
 */

import type { KpiSnapshot } from "./kpi-snapshot.js";
import type { OldestOpenEntry, WorkspaceKpiSummary } from "./kpi-workspace-history.js";
import type { KpiStatus, ProjectKpi } from "./project-kpi.js";

export interface PrometheusFormatInput {
	/** Sanitized workspace name; appears as the `workspace` label on every series. */
	workspace: string;
	perItem: PrometheusPerItemInput[];
	workspaceSummary: WorkspaceKpiSummary;
	oldestOpen: readonly OldestOpenEntry[];
}

export interface PrometheusPerItemInput {
	itemId: string;
	snapshot: KpiSnapshot;
	/**
	 * kpiId -> total reading count from the event log. Used for the
	 * `kanban_kpi_readings_total` counter. KPIs with no readings emit a
	 * 0-value row so PromQL `rate()` works on first reading.
	 */
	readingCounts: Map<string, number>;
}

const STATUS_CODES: Record<KpiStatus, number> = {
	open: 0,
	met: 1,
	missed: 2,
	waived: 3,
};

export function formatPrometheusMetrics(input: PrometheusFormatInput): string {
	const sections: string[] = [
		formatStatusMetric(input),
		formatValueMetric(input),
		formatReadingsCounter(input),
		formatWorkspaceSummary(input),
		formatOldestOpen(input),
	];
	return `${sections.filter((s) => s.length > 0).join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Per-metric formatters
// ---------------------------------------------------------------------------

function formatStatusMetric(input: PrometheusFormatInput): string {
	const lines: string[] = [
		"# HELP kanban_kpi_status Status of each project KPI (0=open 1=met 2=missed 3=waived).",
		"# TYPE kanban_kpi_status gauge",
	];
	const rows = sortedKpiRows(input).map(({ itemId, kpi, evaluation }) => {
		const labels = formatLabels({
			workspace: input.workspace,
			roadmap_item: itemId,
			kpi_id: kpi.id,
			acceptance: kpi.acceptance,
		});
		return `kanban_kpi_status${labels} ${STATUS_CODES[evaluation.status]}`;
	});
	if (rows.length === 0) return "";
	lines.push(...rows);
	return lines.join("\n");
}

function formatValueMetric(input: PrometheusFormatInput): string {
	const numericRows: string[] = [];
	for (const { itemId, kpi, evaluation } of sortedKpiRows(input)) {
		if (kpi.target.kind !== "numeric") continue;
		if (typeof evaluation.aggregatedValue !== "number") continue;
		const labels = formatLabels({
			workspace: input.workspace,
			roadmap_item: itemId,
			kpi_id: kpi.id,
			acceptance: kpi.acceptance,
			unit: kpi.target.unit ?? "",
		});
		numericRows.push(`kanban_kpi_value${labels} ${formatValueNumber(evaluation.aggregatedValue)}`);
	}
	if (numericRows.length === 0) return "";
	return [
		"# HELP kanban_kpi_value Aggregated value of numeric KPIs.",
		"# TYPE kanban_kpi_value gauge",
		...numericRows,
	].join("\n");
}

function formatReadingsCounter(input: PrometheusFormatInput): string {
	const rows: string[] = [];
	for (const { itemId, kpi } of sortedKpiRows(input)) {
		const item = input.perItem.find((p) => p.itemId === itemId);
		const count = item?.readingCounts.get(kpi.id) ?? 0;
		const labels = formatLabels({
			workspace: input.workspace,
			roadmap_item: itemId,
			kpi_id: kpi.id,
			acceptance: kpi.acceptance,
			source: sourceFromAcceptance(kpi.acceptance),
		});
		rows.push(`kanban_kpi_readings_total${labels} ${count}`);
	}
	if (rows.length === 0) return "";
	return [
		"# HELP kanban_kpi_readings_total Total readings appended per KPI since the event log started.",
		"# TYPE kanban_kpi_readings_total counter",
		...rows,
	].join("\n");
}

function formatWorkspaceSummary(input: PrometheusFormatInput): string {
	const labels = formatLabels({ workspace: input.workspace });
	return [
		"# HELP kanban_kpi_workspace_total Total declared KPIs across the workspace.",
		"# TYPE kanban_kpi_workspace_total gauge",
		`kanban_kpi_workspace_total${labels} ${input.workspaceSummary.totalKpis}`,
		"",
		"# HELP kanban_kpi_workspace_met Met (or waived) KPIs across the workspace.",
		"# TYPE kanban_kpi_workspace_met gauge",
		`kanban_kpi_workspace_met${labels} ${input.workspaceSummary.metKpis}`,
		"",
		"# HELP kanban_kpi_workspace_blocked_items Roadmap items where allMet is false.",
		"# TYPE kanban_kpi_workspace_blocked_items gauge",
		`kanban_kpi_workspace_blocked_items${labels} ${input.workspaceSummary.blockedItemIds.length}`,
		"",
		"# HELP kanban_kpi_workspace_regressions KPIs that have regressed (met -> missed) at least once.",
		"# TYPE kanban_kpi_workspace_regressions gauge",
		`kanban_kpi_workspace_regressions${labels} ${input.workspaceSummary.regressionCount}`,
	].join("\n");
}

function formatOldestOpen(input: PrometheusFormatInput): string {
	if (input.oldestOpen.length === 0) return "";
	const sorted = [...input.oldestOpen].sort((a, b) => {
		if (a.roadmapItemId !== b.roadmapItemId) return a.roadmapItemId.localeCompare(b.roadmapItemId);
		return a.kpiId.localeCompare(b.kpiId);
	});
	const lines = [
		"# HELP kanban_kpi_oldest_open_days Days an open KPI has been open since its first reading.",
		"# TYPE kanban_kpi_oldest_open_days gauge",
	];
	for (const entry of sorted) {
		const labels = formatLabels({
			workspace: input.workspace,
			roadmap_item: entry.roadmapItemId,
			kpi_id: entry.kpiId,
		});
		lines.push(`kanban_kpi_oldest_open_days${labels} ${entry.daysOpen}`);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SortedKpiRow {
	itemId: string;
	kpi: ProjectKpi;
	evaluation: KpiSnapshot["kpis"][number]["evaluation"];
}

function sortedKpiRows(input: PrometheusFormatInput): SortedKpiRow[] {
	const rows: SortedKpiRow[] = [];
	for (const item of input.perItem) {
		for (const entry of item.snapshot.kpis) {
			rows.push({ itemId: item.itemId, kpi: entry.definition, evaluation: entry.evaluation });
		}
	}
	rows.sort((a, b) => {
		if (a.itemId !== b.itemId) return a.itemId.localeCompare(b.itemId);
		return a.kpi.id.localeCompare(b.kpi.id);
	});
	return rows;
}

function sourceFromAcceptance(acceptance: ProjectKpi["acceptance"]): string {
	switch (acceptance) {
		case "manual":
			return "manual";
		case "auto-from-task":
			return "task";
		case "auto-from-validator":
			return "validator";
	}
}

function formatValueNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	// Prometheus accepts integers and decimals; preserve precision but trim
	// trailing zeros to keep diffs stable.
	const text = Number.isInteger(value) ? value.toString() : value.toString();
	return text;
}

/** Render `{k1="v1",k2="v2"}` with stable key order + value escaping. */
function formatLabels(labels: Record<string, string>): string {
	const keys = Object.keys(labels).sort();
	if (keys.length === 0) return "";
	const parts = keys.map((key) => `${key}="${escapeLabelValue(labels[key] ?? "")}"`);
	return `{${parts.join(",")}}`;
}

/**
 * Per the Prometheus exposition format, label values must escape
 * backslash, double-quote, and newline. Tabs are allowed verbatim but
 * we replace them with a space for readability.
 */
function escapeLabelValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, " ");
}

/**
 * Sanitize a workspace path basename into a Prometheus-friendly label
 * value. Lowercase + non-`[a-z0-9-_]` characters replaced with `_`.
 */
export function sanitizeWorkspaceLabel(raw: string): string {
	const lower = raw.trim().toLowerCase();
	const cleaned = lower.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return cleaned || "kanban";
}
