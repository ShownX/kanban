/**
 * Load KPI definitions for roadmap items from disk.
 *
 * KPI definitions live in markdown files under `.kanban/kpis/<itemId>.md`,
 * each containing a single `### KPIs` section parsed by `kpi-markdown.ts`.
 * Keeping definitions in their own file (rather than inline in the
 * existing V2 ROADMAP.md table) lets the table format stay simple and
 * lets multiple agents edit different items' KPIs without merge churn.
 *
 * Loading sub-KPIs for tasks works analogously via
 * `.kanban/kpis/tasks/<taskId>.md`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseKpiMarkdownSection } from "./kpi-markdown.js";
import type { ProjectKpi, TaskSubKpi } from "./project-kpi.js";

const KPI_DIR = join(".kanban", "kpis");
const TASK_KPI_DIR = join(".kanban", "kpis", "tasks");

interface LoadResult<T> {
	values: T[];
	warnings: string[];
}

/** Read `.kanban/kpis/<itemId>.md` and parse KPIs from it. */
export async function loadProjectKpisForItem(workspaceRoot: string, itemId: string): Promise<LoadResult<ProjectKpi>> {
	const path = join(workspaceRoot, KPI_DIR, `${itemId}.md`);
	const md = await readMarkdownIfExists(path);
	if (md === null) return { values: [], warnings: [] };
	const { kpis, warnings } = parseKpiMarkdownSection(md);
	return { values: kpis, warnings };
}

/**
 * Read `.kanban/kpis/tasks/<taskId>.md` and parse the sub-KPIs from it.
 *
 * Sub-KPIs use the same markdown format as project KPIs; parentKpiId
 * is encoded as a `parentKpiId:` field on each item.
 */
export async function loadSubKpisForTask(workspaceRoot: string, taskId: string): Promise<LoadResult<TaskSubKpi>> {
	const path = join(workspaceRoot, TASK_KPI_DIR, `${taskId}.md`);
	const md = await readMarkdownIfExists(path);
	if (md === null) return { values: [], warnings: [] };
	const { kpis, warnings } = parseKpiMarkdownSection(md);
	const subKpis: TaskSubKpi[] = kpis.map((kpi) => extractSubKpi(kpi, md));
	return { values: subKpis, warnings };
}

async function readMarkdownIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

/**
 * The shared parser yields ProjectKpi shapes. For tasks we strip the
 * project-only fields (acceptance, aggregate, override) and re-extract
 * `parentKpiId` from the markdown — the parser tolerates unknown keys
 * but doesn't expose them, so we do a small follow-up read.
 */
function extractSubKpi(kpi: ProjectKpi, markdown: string): TaskSubKpi {
	const parentKpiId = readParentKpiId(markdown, kpi.id);
	const sub: TaskSubKpi = {
		id: kpi.id,
		label: kpi.label,
		target: kpi.target,
		readings: [],
	};
	if (kpi.description !== undefined) sub.description = kpi.description;
	if (parentKpiId !== null) sub.parentKpiId = parentKpiId;
	return sub;
}

function readParentKpiId(markdown: string, kpiId: string): string | null {
	const lines = markdown.split(/\r?\n/);
	let inBlock = false;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.startsWith("- id:")) {
			inBlock = line.slice("- id:".length).trim() === kpiId;
			continue;
		}
		if (!inBlock) continue;
		if (line.startsWith("parentKpiId:")) {
			return line.slice("parentKpiId:".length).trim() || null;
		}
	}
	return null;
}
