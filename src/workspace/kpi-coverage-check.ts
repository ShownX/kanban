/**
 * `kpi_coverage` validator check.
 *
 * For each `auto-from-task` KPI on a roadmap item, ensure at least one
 * linked task carries a sub-KPI with the matching `parentKpiId` and a
 * non-empty reading. Catches the gap where validation passes,
 * auto-promote flips the item to done, and the goal was never measured.
 *
 * Skip rules:
 *   - `manual` KPIs       — reviewer records out-of-band; absence isn't
 *                           an agent bug.
 *   - `auto-from-validator` KPIs — Phase B defers to Phase C; we surface
 *                           a "deferred" details line by KPI id so the
 *                           reviewer knows it's by design.
 *
 * Returns a structured result. The full validator (in
 * `src/workspace/validator.ts` on the roadmap-panel branch) consumes
 * this and folds the result into its `checks` array; this module is
 * deliberately storage-agnostic so it can be tested in isolation.
 */

import type { ProjectKpi, TaskSubKpi } from "./project-kpi.js";

export type KpiCoverageStatus = "pass" | "fail" | "needs_review";

export interface KpiCoverageResult {
	check: "kpi_coverage";
	status: KpiCoverageStatus;
	details: string;
	/** KPI ids that had no contributing reading; surfaces in the UI. */
	missingKpiIds: string[];
	/** KPI ids deferred to Phase C; surfaces in a separate hint badge. */
	deferredKpiIds: string[];
}

export interface KpiCoverageInput {
	/** KPIs declared on the roadmap item under validation. */
	itemKpis: readonly ProjectKpi[];
	/**
	 * Sub-KPIs across every linked task on the item. Caller flattens
	 * task → sub-KPI lists; we don't care which task each came from
	 * for the coverage decision (we do care that *some* task wrote
	 * each reading).
	 */
	linkedSubKpis: readonly TaskSubKpi[];
}

export function checkKpiCoverage(input: KpiCoverageInput): KpiCoverageResult {
	if (input.itemKpis.length === 0) {
		return {
			check: "kpi_coverage",
			status: "pass",
			details: "No KPIs declared on this roadmap item; nothing to verify.",
			missingKpiIds: [],
			deferredKpiIds: [],
		};
	}

	const subKpisByParent = new Map<string, TaskSubKpi[]>();
	for (const sub of input.linkedSubKpis) {
		if (!sub.parentKpiId) continue;
		const list = subKpisByParent.get(sub.parentKpiId) ?? [];
		list.push(sub);
		subKpisByParent.set(sub.parentKpiId, list);
	}

	const missingKpiIds: string[] = [];
	const deferredKpiIds: string[] = [];

	for (const kpi of input.itemKpis) {
		if (kpi.acceptance === "manual") continue;
		if (kpi.acceptance === "auto-from-validator") {
			deferredKpiIds.push(kpi.id);
			continue;
		}
		// auto-from-task: at least one matching sub-KPI must carry a non-empty reading.
		const subs = subKpisByParent.get(kpi.id) ?? [];
		const hasContributingReading = subs.some((s) => s.readings.length > 0);
		if (!hasContributingReading) {
			missingKpiIds.push(kpi.id);
		}
	}

	const detailsLines: string[] = [];
	if (missingKpiIds.length > 0) {
		detailsLines.push(`Missing readings for ${missingKpiIds.length} KPI(s): ${missingKpiIds.join(", ")}.`);
	}
	if (deferredKpiIds.length > 0) {
		detailsLines.push(
			`Deferred to Phase C (${deferredKpiIds.length}): ${deferredKpiIds.join(", ")}; auto-from-validator measurement is not yet wired.`,
		);
	}
	if (detailsLines.length === 0) {
		return {
			check: "kpi_coverage",
			status: "pass",
			details: `All ${input.itemKpis.length} KPI(s) covered.`,
			missingKpiIds: [],
			deferredKpiIds: [],
		};
	}

	const status: KpiCoverageStatus = missingKpiIds.length > 0 ? "needs_review" : "pass";
	return {
		check: "kpi_coverage",
		status,
		details: detailsLines.join(" "),
		missingKpiIds,
		deferredKpiIds,
	};
}
