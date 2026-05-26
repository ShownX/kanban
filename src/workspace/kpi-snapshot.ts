/**
 * KPI snapshot — definition + state → presentable summary.
 *
 * The committed roadmap markdown gives us KPI **definitions** (label,
 * target, acceptance, aggregate). The locked JSON state file gives us
 * **readings** + **override**. This module joins those two halves and
 * runs them through `evaluateProjectKpi` so callers (CLI, tRPC, UI)
 * all see the same shape.
 *
 * Pure function. The IO layer (reading the markdown, reading the state
 * file) lives in the caller; this module only reasons about already-loaded
 * data so it stays trivially testable.
 */

import { evaluateProjectKpi, type KpiEvaluation } from "./kpi-engine.js";
import type { KpiStateFile } from "./kpi-state-file.js";
import type { ProjectKpi } from "./project-kpi.js";

export interface KpiSnapshot {
	itemId: string;
	kpis: KpiSnapshotEntry[];
	allMet: boolean;
	blockingKpis: string[];
}

export interface KpiSnapshotEntry {
	definition: ProjectKpi;
	evaluation: KpiEvaluation;
}

export interface BuildKpiSnapshotInput {
	itemId: string;
	/** Definitions parsed from the roadmap markdown for this item. */
	definitions: readonly ProjectKpi[];
	/**
	 * State store loaded from `.kanban/kpi-state.json`. Used to layer
	 * readings + override on top of each definition.
	 */
	state: KpiStateFile;
}

/**
 * Join definitions with state and evaluate each KPI. Definitions
 * coming straight from markdown have empty `readings` and no override;
 * state from the JSON file fills both in.
 *
 * `allMet` is true only when every KPI is `met` or `waived` (the same
 * condition the roadmap auto-promote rule uses).
 *
 * `blockingKpis` lists ids of KPIs that are not yet `met` / `waived` —
 * useful for the "this item can't auto-promote until …" UI banner and
 * for CLI exit codes.
 */
export function buildKpiSnapshot(input: BuildKpiSnapshotInput): KpiSnapshot {
	const itemState = input.state.items[input.itemId];
	const entries: KpiSnapshotEntry[] = input.definitions.map((definition) => {
		const stateEntry = itemState?.kpis[definition.id];
		const merged: ProjectKpi = {
			...definition,
			readings: stateEntry?.readings ?? definition.readings,
			override: stateEntry?.override ?? definition.override,
		};
		return { definition: merged, evaluation: evaluateProjectKpi(merged) };
	});
	const blockingKpis = entries
		.filter((e) => e.evaluation.status !== "met" && e.evaluation.status !== "waived")
		.map((e) => e.definition.id);
	return {
		itemId: input.itemId,
		kpis: entries,
		allMet: blockingKpis.length === 0,
		blockingKpis,
	};
}

/**
 * Convenience: flatten the snapshot into a one-line-per-KPI summary
 * suitable for `--format=text` CLI output. Width-respecting; the
 * caller can pipe to `column` if they want alignment.
 */
export function formatSnapshotAsText(snapshot: KpiSnapshot): string {
	if (snapshot.kpis.length === 0) {
		return `${snapshot.itemId}: no KPIs declared`;
	}
	const lines: string[] = [`${snapshot.itemId}: ${formatRollup(snapshot)}`];
	for (const entry of snapshot.kpis) {
		const valueDisplay =
			entry.evaluation.aggregatedValue === null ? "no readings" : String(entry.evaluation.aggregatedValue);
		lines.push(
			`  ${entry.definition.id} [${entry.evaluation.status}] target=${formatTarget(entry.definition)} value=${valueDisplay}`,
		);
	}
	return lines.join("\n");
}

function formatRollup(snapshot: KpiSnapshot): string {
	const total = snapshot.kpis.length;
	const met = snapshot.kpis.filter((e) => e.evaluation.status === "met").length;
	const waived = snapshot.kpis.filter((e) => e.evaluation.status === "waived").length;
	const missed = snapshot.kpis.filter((e) => e.evaluation.status === "missed").length;
	const open = snapshot.kpis.filter((e) => e.evaluation.status === "open").length;
	const parts: string[] = [`${met}/${total} met`];
	if (waived > 0) parts.push(`${waived} waived`);
	if (missed > 0) parts.push(`${missed} missed`);
	if (open > 0) parts.push(`${open} open`);
	return parts.join(", ");
}

function formatTarget(kpi: ProjectKpi): string {
	switch (kpi.target.kind) {
		case "boolean":
			return "boolean";
		case "numeric": {
			const unit = kpi.target.unit ? kpi.target.unit : "";
			return `${kpi.target.op}${kpi.target.value}${unit}`;
		}
		case "rubric":
			return `rubric>=${kpi.target.minimum}`;
	}
}
