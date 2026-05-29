/**
 * Extract structured KPI measurements from a task's experiment logs.
 *
 * Phase B explicitly deferred `acceptance: auto-from-validator` KPIs.
 * Phase C (this module) wires them up: when a task agent writes a
 * measurement into one of its experiment log files, we parse it out
 * and emit a `source: "validator"` reading against the matching
 * project KPI.
 *
 * Two recognized formats:
 *
 *   1. **Plaintext line marker** in a `.log` / `.txt` / `.md` file:
 *
 *        KPI p99_latency = 178 ms
 *        kpi p99_latency: 178
 *        kpi rollback_runbook = true
 *        kpi dx_rating = good
 *
 *      The leading `kpi` token is case-insensitive. The value after
 *      `=` or `:` is matched against the parent KPI's target kind.
 *
 *   2. **Structured JSON** with `kpiReadings: [{ kpiId, value }]` at
 *      the top level. JSON files only.
 *
 * Pure function: caller hands in the loaded experiment log entries
 * + the parent project KPI definitions.
 */

import type { ExperimentLogEntry } from "./experiment-log-file.js";
import type { KpiReading, ProjectKpi } from "./project-kpi.js";

export interface ExtractKpiReadingsInput {
	logs: readonly ExperimentLogEntry[];
	parentKpis: readonly ProjectKpi[];
}

export interface ExtractedKpiReading {
	kpiId: string;
	reading: KpiReading;
	/** Filename the measurement came from; copied into reading.experimentLog. */
	source: string;
}

/** KPI line pattern: `kpi <id> = <value>` or `kpi <id>: <value>`. */
const KPI_LINE_PATTERN = /^\s*kpi\s+([a-zA-Z0-9_-]+)\s*[:=]\s*(.+?)\s*$/i;

/**
 * Walk every experiment log and pull out KPI measurements that match
 * one of the parent KPI ids. Only `auto-from-validator` parents are
 * considered — readings against other policies would be silently
 * ignored by the snapshot anyway, so we save the lookup.
 */
export function extractKpiReadings(input: ExtractKpiReadingsInput): ExtractedKpiReading[] {
	const validatorKpis = new Map<string, ProjectKpi>();
	for (const kpi of input.parentKpis) {
		if (kpi.acceptance === "auto-from-validator") validatorKpis.set(kpi.id, kpi);
	}
	if (validatorKpis.size === 0) return [];

	const out: ExtractedKpiReading[] = [];
	for (const log of input.logs) {
		if (log.relativePath.endsWith(".json")) {
			const fromJson = tryExtractJson(log, validatorKpis);
			out.push(...fromJson);
			continue;
		}
		const fromText = extractFromText(log, validatorKpis);
		out.push(...fromText);
	}
	return out;
}

function extractFromText(log: ExperimentLogEntry, validatorKpis: Map<string, ProjectKpi>): ExtractedKpiReading[] {
	const readings: ExtractedKpiReading[] = [];
	const lines = log.content.split(/\r?\n/);
	for (const line of lines) {
		const match = KPI_LINE_PATTERN.exec(line);
		if (!match) continue;
		const kpiId = match[1]!;
		const valueText = match[2]!;
		const kpi = validatorKpis.get(kpiId);
		if (!kpi) continue;
		const reading = parseValueByTarget(kpi, valueText, log);
		if (reading) readings.push({ kpiId, reading, source: log.name });
	}
	return readings;
}

function tryExtractJson(log: ExperimentLogEntry, validatorKpis: Map<string, ProjectKpi>): ExtractedKpiReading[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(log.content);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const root = parsed as { kpiReadings?: unknown };
	if (!Array.isArray(root.kpiReadings)) return [];
	const out: ExtractedKpiReading[] = [];
	for (const entry of root.kpiReadings) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as { kpiId?: unknown; value?: unknown; note?: unknown };
		if (typeof record.kpiId !== "string") continue;
		const kpi = validatorKpis.get(record.kpiId);
		if (!kpi) continue;
		const reading = readingFromTypedValue(
			kpi,
			record.value,
			log,
			typeof record.note === "string" ? record.note : undefined,
		);
		if (reading) out.push({ kpiId: record.kpiId, reading, source: log.name });
	}
	return out;
}

function parseValueByTarget(kpi: ProjectKpi, valueText: string, log: ExperimentLogEntry): KpiReading | null {
	const recordedAt = new Date(log.mtime).toISOString();
	switch (kpi.target.kind) {
		case "boolean": {
			if (valueText === "true") return baseReading(recordedAt, log, { booleanValue: true });
			if (valueText === "false") return baseReading(recordedAt, log, { booleanValue: false });
			return null;
		}
		case "numeric": {
			// Strip trailing unit (e.g. "178 ms" -> "178") before parsing.
			const numericText = valueText.replace(/\s*[a-zA-Z%/]+$/, "").trim();
			const numeric = Number.parseFloat(numericText);
			if (Number.isNaN(numeric)) return null;
			return baseReading(recordedAt, log, { numericValue: numeric });
		}
		case "rubric": {
			if (!kpi.target.levels.includes(valueText)) return null;
			return baseReading(recordedAt, log, { rubricValue: valueText });
		}
	}
}

function readingFromTypedValue(
	kpi: ProjectKpi,
	value: unknown,
	log: ExperimentLogEntry,
	note: string | undefined,
): KpiReading | null {
	const recordedAt = new Date(log.mtime).toISOString();
	switch (kpi.target.kind) {
		case "boolean":
			if (typeof value !== "boolean") return null;
			return baseReading(recordedAt, log, { booleanValue: value, note });
		case "numeric":
			if (typeof value !== "number") return null;
			return baseReading(recordedAt, log, { numericValue: value, note });
		case "rubric":
			if (typeof value !== "string" || !kpi.target.levels.includes(value)) return null;
			return baseReading(recordedAt, log, { rubricValue: value, note });
	}
}

function baseReading(recordedAt: string, log: ExperimentLogEntry, rest: Partial<KpiReading>): KpiReading {
	return {
		recordedAt,
		source: "validator",
		experimentLog: log.name,
		...rest,
	};
}
