/**
 * Prometheus exporter IO layer.
 *
 * Builds a `PrometheusFormatInput` from on-disk state, calls the pure
 * format module, and atomically writes the result to
 * `.kanban/kpi-metrics.prom` (or a caller-specified path).
 *
 * Skips the rename step when the formatted text is byte-identical to
 * what's already on disk so the file's mtime doesn't churn while
 * Prometheus is scraping.
 */

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { lockedFileSystem } from "../fs/locked-file-system.js";
import { readKpiEvents } from "./kpi-event-log.js";
import { kpiRegressions } from "./kpi-history.js";
import {
	formatPrometheusMetrics,
	type PrometheusPerItemInput,
	sanitizeWorkspaceLabel,
} from "./kpi-prometheus-format.js";
import { loadProjectKpisForItem } from "./kpi-roadmap-loader.js";
import { buildKpiSnapshot } from "./kpi-snapshot.js";
import { readKpiStateFile } from "./kpi-state-file.js";
import { oldestOpenKpis, workspaceKpiSummary } from "./kpi-workspace-history.js";
import { parseRoadmapMarkdown, readRoadmapFile } from "./roadmap-file.js";

const KANBAN_DIR = ".kanban";
const DEFAULT_METRICS_FILE = "kpi-metrics.prom";

export interface WriteKpiPrometheusOptions {
	/** Override where the .prom file is written. Default: .kanban/kpi-metrics.prom. */
	outputPath?: string;
	/** Override the workspace label. Default: sanitized basename of workspaceRoot. */
	workspaceLabel?: string;
	/** Cap for the oldest-open list emitted as kanban_kpi_oldest_open_days. Default 50. */
	oldestOpenLimit?: number;
}

export interface WriteKpiPrometheusResult {
	path: string;
	bytes: number;
	changed: boolean;
}

/**
 * Read on-disk KPI state, format as Prometheus metrics, write atomically.
 *
 * Returns `changed: false` and no rewrite when the formatted output is
 * byte-identical to what's already at `path`.
 */
export async function writeKpiPrometheusMetrics(
	workspaceRoot: string,
	options: WriteKpiPrometheusOptions = {},
): Promise<WriteKpiPrometheusResult> {
	const path = options.outputPath ?? join(workspaceRoot, KANBAN_DIR, DEFAULT_METRICS_FILE);
	const workspaceLabel = options.workspaceLabel ?? sanitizeWorkspaceLabel(basename(workspaceRoot));
	const limit = options.oldestOpenLimit ?? 50;

	const input = await buildPrometheusInput(workspaceRoot, workspaceLabel, limit);
	const text = formatPrometheusMetrics(input);

	const existing = await readIfExists(path);
	if (existing === text) {
		return { path, bytes: existing.length, changed: false };
	}
	await lockedFileSystem.writeTextFileAtomic(path, text, { lock: { path, type: "file" } });
	return { path, bytes: text.length, changed: true };
}

async function buildPrometheusInput(
	workspaceRoot: string,
	workspaceLabel: string,
	oldestOpenLimit: number,
): Promise<Parameters<typeof formatPrometheusMetrics>[0]> {
	const { content: roadmapContent } = await readRoadmapFile(workspaceRoot);
	const roadmapItems = parseRoadmapMarkdown(roadmapContent);
	const itemIds = roadmapItems.map((item) => item.id);

	const events = await readKpiEvents(workspaceRoot);
	const state = await readKpiStateFile(workspaceRoot);

	const perItem: PrometheusPerItemInput[] = await Promise.all(
		itemIds.map(async (itemId) => {
			const { values: definitions } = await loadProjectKpisForItem(workspaceRoot, itemId);
			const snapshot = buildKpiSnapshot({ itemId, definitions, state });
			const readingCounts = countReadingsByKpi(events, itemId);
			return { itemId, snapshot, readingCounts };
		}),
	);

	const summaryInput = perItem.map((entry) => ({
		itemId: entry.itemId,
		snapshot: entry.snapshot,
		regressionCount: kpiRegressions(events, entry.itemId).length,
	}));
	const workspaceSummary = workspaceKpiSummary(summaryInput);
	const oldestOpen = oldestOpenKpis(events, summaryInput, oldestOpenLimit);

	return {
		workspace: workspaceLabel,
		perItem,
		workspaceSummary,
		oldestOpen,
	};
}

function countReadingsByKpi(
	events: ReturnType<typeof readKpiEvents> extends Promise<infer T> ? T : never,
	itemId: string,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const event of events) {
		if (event.type !== "reading_appended") continue;
		if (event.scope.kind !== "project") continue;
		if (event.scope.itemId !== itemId) continue;
		counts.set(event.scope.kpiId, (counts.get(event.scope.kpiId) ?? 0) + 1);
	}
	return counts;
}

async function readIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}
