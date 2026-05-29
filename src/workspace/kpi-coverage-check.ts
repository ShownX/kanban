/**
 * `kpi_coverage` validator check.
 *
 * For each non-manual KPI on a roadmap item, ensure at least one
 * matching reading exists. Catches the gap where validation passes,
 * auto-promote flips the item to done, and the goal was never measured.
 *
 * Per-policy rules:
 *   - `manual` KPIs            — skipped; reviewer records out-of-band,
 *                                absence isn't an agent bug.
 *   - `auto-from-task` KPIs    — at least one linked task must carry a
 *                                sub-KPI with matching `parentKpiId`
 *                                and a non-empty reading.
 *   - `auto-from-validator` KPIs — at least one validator-source
 *                                reading must exist on the parent KPI
 *                                itself. Phase C's experiment-log
 *                                extractor populates these; before
 *                                Phase C this policy was deferred.
 *
 * Returns a structured result. The validator (in
 * `src/workspace/validator.ts`) consumes this and folds the result
 * into its `checks` array; this module is deliberately storage-agnostic
 * so it can be tested in isolation.
 */

import type { ProjectKpi, TaskSubKpi } from "./project-kpi.js";

export type KpiCoverageStatus = "pass" | "fail" | "needs_review";

export interface KpiCoverageResult {
	check: "kpi_coverage";
	status: KpiCoverageStatus;
	details: string;
	/** KPI ids that had no contributing reading; surfaces in the UI. */
	missingKpiIds: string[];
	/** Deprecated: kept for backwards compatibility, always empty in Phase C+. */
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

	for (const kpi of input.itemKpis) {
		if (kpi.acceptance === "manual") continue;
		if (kpi.acceptance === "auto-from-validator") {
			const hasValidatorReading = kpi.readings.some((r) => r.source === "validator");
			if (!hasValidatorReading) missingKpiIds.push(kpi.id);
			continue;
		}
		// auto-from-task: at least one matching sub-KPI must carry a non-empty reading.
		const subs = subKpisByParent.get(kpi.id) ?? [];
		const hasContributingReading = subs.some((s) => s.readings.length > 0);
		if (!hasContributingReading) {
			missingKpiIds.push(kpi.id);
		}
	}

	if (missingKpiIds.length === 0) {
		return {
			check: "kpi_coverage",
			status: "pass",
			details: `All ${input.itemKpis.length} KPI(s) covered.`,
			missingKpiIds: [],
			deferredKpiIds: [],
		};
	}

	return {
		check: "kpi_coverage",
		status: "needs_review",
		details: `Missing readings for ${missingKpiIds.length} KPI(s): ${missingKpiIds.join(", ")}.`,
		missingKpiIds,
		deferredKpiIds: [],
	};
}
