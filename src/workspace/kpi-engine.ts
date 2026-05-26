/**
 * KPI status engine.
 *
 * Resolves a KPI's `readings` (plus its `override` and `acceptance`)
 * into a status. The four rules — override → filter by source →
 * aggregate → check target — come straight from the design doc
 * (§"How a KPI becomes 'met'").
 *
 * Pure functions only. No file IO, no clock side-effects (callers pass
 * the recordedAt timestamps).
 */

import type {
	KpiAcceptance,
	KpiAggregate,
	KpiReading,
	KpiReadingSource,
	KpiStatus,
	KpiTarget,
	ProjectKpi,
} from "./project-kpi.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface KpiEvaluation {
	status: KpiStatus;
	/** Aggregated value used for the target check. Null when no readings count. */
	aggregatedValue: boolean | number | string | null;
	/** Readings that contributed to the aggregate, newest-first. */
	contributingReadings: KpiReading[];
	/** Diagnostic warnings for misconfigurations (incompatible aggregate, etc.). */
	warnings: string[];
}

/**
 * Compute the live status of a project KPI from its definition + history.
 * Implements §"How a KPI becomes 'met'":
 *   1. Override wins.
 *   2. Filter readings by acceptance-implied source.
 *   3. Aggregate readings via `aggregate`.
 *   4. Check the aggregated value against the target.
 *
 * Returns `open` when no readings count (and no override is set).
 */
export function evaluateProjectKpi(kpi: ProjectKpi): KpiEvaluation {
	if (kpi.override) {
		return {
			status: kpi.override.status,
			aggregatedValue: null,
			contributingReadings: [],
			warnings: [],
		};
	}
	const allowedSource = sourceForAcceptance(kpi.acceptance);
	const relevant = filterAndOrderReadings(kpi.readings, allowedSource);
	if (relevant.length === 0) {
		return { status: "open", aggregatedValue: null, contributingReadings: [], warnings: [] };
	}
	const aggregation = aggregateReadings(relevant, kpi.target, kpi.aggregate);
	if (aggregation.value === null) {
		return {
			status: "open",
			aggregatedValue: null,
			contributingReadings: relevant,
			warnings: aggregation.warnings,
		};
	}
	const meets = checkTarget(kpi.target, aggregation.value);
	return {
		status: meets ? "met" : "missed",
		aggregatedValue: aggregation.value,
		contributingReadings: relevant,
		warnings: aggregation.warnings,
	};
}

/**
 * Convenience for sub-KPIs, which have the same shape minus override /
 * acceptance / aggregate. Sub-KPIs use latest-wins implicitly and
 * accept readings from any source — they're evidence the agent
 * provides, not a policy gate.
 */
export function evaluateTaskSubKpi(input: { target: KpiTarget; readings: KpiReading[] }): KpiEvaluation {
	const sorted = orderByRecordedAtDesc(input.readings);
	if (sorted.length === 0) {
		return { status: "open", aggregatedValue: null, contributingReadings: [], warnings: [] };
	}
	const aggregation = aggregateReadings(sorted, input.target, "latest");
	if (aggregation.value === null) {
		return {
			status: "open",
			aggregatedValue: null,
			contributingReadings: sorted,
			warnings: aggregation.warnings,
		};
	}
	const meets = checkTarget(input.target, aggregation.value);
	return {
		status: meets ? "met" : "missed",
		aggregatedValue: aggregation.value,
		contributingReadings: sorted,
		warnings: aggregation.warnings,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sourceForAcceptance(acceptance: KpiAcceptance): KpiReadingSource {
	switch (acceptance) {
		case "manual":
			return "manual";
		case "auto-from-task":
			return "task";
		case "auto-from-validator":
			return "validator";
	}
}

function filterAndOrderReadings(readings: KpiReading[], source: KpiReadingSource): KpiReading[] {
	return orderByRecordedAtDesc(readings.filter((r) => r.source === source));
}

function orderByRecordedAtDesc(readings: KpiReading[]): KpiReading[] {
	return [...readings].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}

interface AggregationResult {
	value: boolean | number | string | null;
	warnings: string[];
}

function aggregateReadings(readings: KpiReading[], target: KpiTarget, aggregate: KpiAggregate): AggregationResult {
	// Pick out the values that actually match the target's kind.
	const compatible = readings.filter((r) => readingValue(r, target.kind) !== null);
	if (compatible.length === 0) {
		const warning =
			readings.length > 0
				? `KPI has ${readings.length} reading(s) but none match the target kind "${target.kind}".`
				: "";
		return { value: null, warnings: warning ? [warning] : [] };
	}
	const warnings: string[] = [];
	const effectiveAggregate = ensureAggregateCompatible(aggregate, target.kind, warnings);
	switch (effectiveAggregate) {
		case "latest": {
			const value = readingValue(compatible[0]!, target.kind);
			return { value, warnings };
		}
		case "sum": {
			const sum = compatible.reduce<number>((total, r) => {
				const v = readingValue(r, target.kind);
				return typeof v === "number" ? total + v : total;
			}, 0);
			return { value: sum, warnings };
		}
		case "min": {
			return aggregateMinMax(compatible, target, "min", warnings);
		}
		case "max": {
			return aggregateMinMax(compatible, target, "max", warnings);
		}
		case "all-must-meet": {
			const allMeet = compatible.every((r) => {
				const v = readingValue(r, target.kind);
				return v !== null && checkTarget(target, v);
			});
			// Surface the value that drove the verdict — for booleans this is
			// just `true` / `false`; for numerics/rubric we surface the latest
			// so the UI has something to show.
			const surfacedValue = target.kind === "boolean" ? allMeet : readingValue(compatible[0]!, target.kind);
			return { value: surfacedValue, warnings };
		}
	}
}

function aggregateMinMax(
	readings: KpiReading[],
	target: KpiTarget,
	mode: "min" | "max",
	warnings: string[],
): AggregationResult {
	if (target.kind === "numeric") {
		const numbers = readings.map((r) => r.numericValue).filter((v): v is number => typeof v === "number");
		if (numbers.length === 0) return { value: null, warnings };
		return {
			value: mode === "min" ? Math.min(...numbers) : Math.max(...numbers),
			warnings,
		};
	}
	if (target.kind === "rubric") {
		const order = new Map(target.levels.map((level, idx) => [level, idx]));
		const rubricReadings = readings
			.map((r) => r.rubricValue)
			.filter((v): v is string => typeof v === "string" && order.has(v));
		if (rubricReadings.length === 0) return { value: null, warnings };
		const sorted = [...rubricReadings].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
		return { value: mode === "min" ? sorted[0]! : sorted[sorted.length - 1]!, warnings };
	}
	// Boolean min/max: min = AND, max = OR.
	const bools = readings.map((r) => r.booleanValue).filter((v): v is boolean => typeof v === "boolean");
	if (bools.length === 0) return { value: null, warnings };
	return {
		value: mode === "min" ? bools.every(Boolean) : bools.some(Boolean),
		warnings,
	};
}

function ensureAggregateCompatible(aggregate: KpiAggregate, kind: KpiTarget["kind"], warnings: string[]): KpiAggregate {
	if (aggregate === "sum" && kind !== "numeric") {
		warnings.push(`Aggregate "sum" only applies to numeric targets; falling back to "latest".`);
		return "latest";
	}
	return aggregate;
}

function readingValue(reading: KpiReading, kind: KpiTarget["kind"]): boolean | number | string | null {
	if (kind === "boolean" && typeof reading.booleanValue === "boolean") return reading.booleanValue;
	if (kind === "numeric" && typeof reading.numericValue === "number") return reading.numericValue;
	if (kind === "rubric" && typeof reading.rubricValue === "string") return reading.rubricValue;
	return null;
}

function checkTarget(target: KpiTarget, value: boolean | number | string): boolean {
	switch (target.kind) {
		case "boolean":
			return value === true;
		case "numeric": {
			if (typeof value !== "number") return false;
			switch (target.op) {
				case ">=":
					return value >= target.value;
				case "<=":
					return value <= target.value;
				case "==":
					return value === target.value;
				case "<":
					return value < target.value;
				case ">":
					return value > target.value;
			}
			return false;
		}
		case "rubric": {
			if (typeof value !== "string") return false;
			const order = new Map(target.levels.map((level, idx) => [level, idx]));
			const valueIdx = order.get(value);
			const minimumIdx = order.get(target.minimum);
			if (valueIdx === undefined || minimumIdx === undefined) return false;
			return valueIdx >= minimumIdx;
		}
	}
}
