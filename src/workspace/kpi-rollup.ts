/**
 * Sub-KPI → KPI rollup.
 *
 * Implements §"Sub-KPI → KPI rollup" from `.plan/docs/kpi-tracking-design.md`:
 *
 *   When a task with a sub-KPI is accepted, for each sub-KPI with a
 *   `parentKpiId`, append the sub-KPI's latest reading to the parent
 *   (tagged source: "task", with the originating taskId) — but only if
 *   the parent's acceptance is "auto-from-task".
 *
 * Pure functions: no IO, no clock side-effects. Callers do the file
 * write; this module decides what the new readings list should look like.
 */

import type { KpiReading, ProjectKpi, TaskSubKpi } from "./project-kpi.js";

export interface RollupInput {
	/** The roadmap-item KPIs we're folding sub-KPI readings into. */
	parentKpis: readonly ProjectKpi[];
	/**
	 * Sub-KPIs from a single accepted task. We rebrand each sub-KPI's
	 * latest reading as a parent reading.
	 */
	taskSubKpis: readonly TaskSubKpi[];
	/** Originating task id, copied onto every appended reading. */
	taskId: string;
}

export interface RollupResult {
	/**
	 * Updated parent KPIs. KPIs with no contribution are returned
	 * unchanged (referentially identical) so callers can short-circuit
	 * disk writes when nothing changed.
	 */
	parentKpis: ProjectKpi[];
	/**
	 * Readings that were appended, indexed by parent KPI id. Useful for
	 * audit-trail emit (Phase B branch 3 will append these to
	 * validation-report.md `## KPI Readings`).
	 */
	appendedReadings: Map<string, KpiReading[]>;
}

/**
 * Fold a task's sub-KPI readings into the parent KPIs' `readings`.
 *
 * Skip rules (from the design doc):
 *   - Sub-KPI without a `parentKpiId`            → informational only.
 *   - Parent KPI not in the input                → ignore (logged).
 *   - Parent acceptance !== "auto-from-task"     → ignore: that policy
 *     wants its readings from a different source.
 *   - Sub-KPI without any readings               → "agent didn't measure
 *     it, so the parent doesn't pretend it did."
 */
export function rollUpSubKpiReadings(input: RollupInput): RollupResult {
	const parentById = new Map(input.parentKpis.map((kpi) => [kpi.id, kpi] as const));
	const appendedReadings = new Map<string, KpiReading[]>();

	for (const sub of input.taskSubKpis) {
		if (!sub.parentKpiId) continue;
		const parent = parentById.get(sub.parentKpiId);
		if (!parent) continue;
		if (parent.acceptance !== "auto-from-task") continue;
		if (sub.readings.length === 0) continue;
		const latest = pickLatestReading(sub.readings);
		const rebranded = rebrandAsTaskReading(latest, input.taskId);
		const list = appendedReadings.get(parent.id) ?? [];
		list.push(rebranded);
		appendedReadings.set(parent.id, list);
	}

	if (appendedReadings.size === 0) {
		return { parentKpis: [...input.parentKpis], appendedReadings };
	}

	const updated = input.parentKpis.map((kpi) => {
		const additions = appendedReadings.get(kpi.id);
		if (!additions || additions.length === 0) return kpi;
		return { ...kpi, readings: [...kpi.readings, ...additions] };
	});

	return { parentKpis: updated, appendedReadings };
}

function pickLatestReading(readings: readonly KpiReading[]): KpiReading {
	let latest = readings[0]!;
	let latestMs = Date.parse(latest.recordedAt);
	for (let i = 1; i < readings.length; i += 1) {
		const candidate = readings[i]!;
		const candidateMs = Date.parse(candidate.recordedAt);
		if (candidateMs > latestMs) {
			latest = candidate;
			latestMs = candidateMs;
		}
	}
	return latest;
}

function rebrandAsTaskReading(reading: KpiReading, taskId: string): KpiReading {
	return {
		recordedAt: reading.recordedAt,
		source: "task",
		taskId,
		validatorCheck: reading.validatorCheck,
		experimentLog: reading.experimentLog,
		booleanValue: reading.booleanValue,
		numericValue: reading.numericValue,
		rubricValue: reading.rubricValue,
		note: reading.note,
	};
}
