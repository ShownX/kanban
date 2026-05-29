/**
 * Wraps the four KPI state mutations so each emits the right events.
 *
 * Pattern (per Phase C design):
 *   1. Read the affected KPI's prior status.
 *   2. Apply the mutation as Phase B does.
 *   3. Read the new status.
 *   4. Emit a mutation event (reading_appended / override_set /
 *      override_cleared) and, when the status flipped, an extra
 *      status_changed event.
 *
 * Phase B's helpers in `kpi-state-file.ts` keep their original
 * call-site semantics; this module is the single producer of KPI
 * event-log entries.
 */

import { evaluateProjectKpi, evaluateTaskSubKpi, type KpiEvaluation } from "./kpi-engine.js";
import { appendKpiEvents, type KpiEventInput } from "./kpi-event-log.js";
import { loadProjectKpisForItem, loadSubKpisForTask } from "./kpi-roadmap-loader.js";
import {
	appendKpiReading,
	appendSubKpiReading,
	clearKpiOverride,
	readKpiStateFile,
	setKpiOverride,
} from "./kpi-state-file.js";
import type { KpiOverride, KpiReading, ProjectKpi, TaskSubKpi } from "./project-kpi.js";

interface ProjectScopeArgs {
	workspaceRoot: string;
	itemId: string;
	kpiId: string;
}

interface TaskScopeArgs {
	workspaceRoot: string;
	taskId: string;
	subKpiId: string;
}

/** Append a project KPI reading + emit events. */
export async function recordKpiReading(args: ProjectScopeArgs & { reading: KpiReading }): Promise<void> {
	const before = await evaluateProject(args);
	await appendKpiReading(args.workspaceRoot, {
		itemId: args.itemId,
		kpiId: args.kpiId,
		reading: args.reading,
	});
	const after = await evaluateProject(args);
	await emit(args.workspaceRoot, [
		{
			type: "reading_appended",
			scope: { kind: "project", itemId: args.itemId, kpiId: args.kpiId },
			reading: args.reading,
		},
		...maybeStatusChange(before, after, { kind: "project", itemId: args.itemId, kpiId: args.kpiId }),
	]);
}

/** Append a sub-KPI reading + emit events. */
export async function recordSubKpiReading(args: TaskScopeArgs & { reading: KpiReading }): Promise<void> {
	const before = await evaluateSub(args);
	await appendSubKpiReading(args.workspaceRoot, {
		taskId: args.taskId,
		subKpiId: args.subKpiId,
		reading: args.reading,
	});
	const after = await evaluateSub(args);
	await emit(args.workspaceRoot, [
		{
			type: "reading_appended",
			scope: { kind: "task", taskId: args.taskId, subKpiId: args.subKpiId },
			reading: args.reading,
		},
		...maybeStatusChange(before, after, { kind: "task", taskId: args.taskId, subKpiId: args.subKpiId }),
	]);
}

/** Set an override + emit events. */
export async function recordKpiOverrideSet(args: ProjectScopeArgs & { override: KpiOverride }): Promise<void> {
	const before = await evaluateProject(args);
	await setKpiOverride(args.workspaceRoot, {
		itemId: args.itemId,
		kpiId: args.kpiId,
		override: args.override,
	});
	const after = await evaluateProject(args);
	await emit(args.workspaceRoot, [
		{
			type: "override_set",
			scope: { kind: "project", itemId: args.itemId, kpiId: args.kpiId },
			override: args.override,
		},
		...maybeStatusChange(before, after, { kind: "project", itemId: args.itemId, kpiId: args.kpiId }),
	]);
}

/** Clear an override + emit events. */
export async function recordKpiOverrideCleared(args: ProjectScopeArgs): Promise<void> {
	const before = await evaluateProject(args);
	await clearKpiOverride(args.workspaceRoot, { itemId: args.itemId, kpiId: args.kpiId });
	const after = await evaluateProject(args);
	await emit(args.workspaceRoot, [
		{
			type: "override_cleared",
			scope: { kind: "project", itemId: args.itemId, kpiId: args.kpiId },
		},
		...maybeStatusChange(before, after, { kind: "project", itemId: args.itemId, kpiId: args.kpiId }),
	]);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function evaluateProject(args: ProjectScopeArgs): Promise<KpiEvaluation | null> {
	const def = await loadProjectKpiDefinition(args);
	if (!def) return null;
	const state = await readKpiStateFile(args.workspaceRoot);
	const stateEntry = state.items[args.itemId]?.kpis[args.kpiId];
	const merged: ProjectKpi = {
		...def,
		readings: stateEntry?.readings ?? def.readings,
		override: stateEntry?.override ?? def.override,
	};
	return evaluateProjectKpi(merged);
}

async function loadProjectKpiDefinition(args: ProjectScopeArgs): Promise<ProjectKpi | null> {
	const { values } = await loadProjectKpisForItem(args.workspaceRoot, args.itemId);
	return values.find((kpi) => kpi.id === args.kpiId) ?? null;
}

async function evaluateSub(args: TaskScopeArgs): Promise<KpiEvaluation | null> {
	const def = await loadSubKpiDefinition(args);
	if (!def) return null;
	const state = await readKpiStateFile(args.workspaceRoot);
	const stateReadings = state.tasks[args.taskId]?.subKpis[args.subKpiId]?.readings ?? def.readings;
	return evaluateTaskSubKpi({ target: def.target, readings: stateReadings });
}

async function loadSubKpiDefinition(args: TaskScopeArgs): Promise<TaskSubKpi | null> {
	const { values } = await loadSubKpisForTask(args.workspaceRoot, args.taskId);
	return values.find((sub) => sub.id === args.subKpiId) ?? null;
}

function maybeStatusChange(
	before: KpiEvaluation | null,
	after: KpiEvaluation | null,
	scope: KpiEventInput["scope"],
): KpiEventInput[] {
	if (!before || !after) return [];
	if (before.status === after.status) return [];
	return [
		{
			type: "status_changed",
			scope,
			statusFrom: before.status,
			statusTo: after.status,
		},
	];
}

async function emit(workspaceRoot: string, events: KpiEventInput[]): Promise<void> {
	if (events.length === 0) return;
	await appendKpiEvents(workspaceRoot, events);
}
