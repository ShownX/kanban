import { describe, expect, it } from "vitest";

import type { ExperimentLogEntry } from "../../../src/workspace/experiment-log-file";
import { extractKpiReadings } from "../../../src/workspace/kpi-validator-extractor";
import type { ProjectKpi } from "../../../src/workspace/project-kpi";

const MTIME = Date.parse("2026-05-28T12:00:00.000Z");

function log(name: string, content: string, ext = ".log"): ExperimentLogEntry {
	return {
		name,
		relativePath: `experiments/${name}${ext}`,
		content,
		mtime: MTIME,
		bytes: content.length,
		truncated: false,
	};
}

function kpi(id: string, target: ProjectKpi["target"]): ProjectKpi {
	return {
		id,
		label: id,
		target,
		acceptance: "auto-from-validator",
		aggregate: "latest",
		readings: [],
	};
}

describe("extractKpiReadings", () => {
	it("returns empty when no parent KPI is auto-from-validator", () => {
		const out = extractKpiReadings({
			logs: [log("perf.log", "kpi p99_latency = 178 ms")],
			parentKpis: [
				{ ...kpi("p99_latency", { kind: "numeric", op: "<=", value: 200 }), acceptance: "auto-from-task" },
			],
		});
		expect(out).toEqual([]);
	});

	it("extracts a numeric reading with a unit suffix", () => {
		const out = extractKpiReadings({
			logs: [log("perf.log", "Other line\nkpi p99_latency = 178 ms\nMore noise")],
			parentKpis: [kpi("p99_latency", { kind: "numeric", op: "<=", value: 200, unit: "ms" })],
		});
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			kpiId: "p99_latency",
			source: "perf.log",
			reading: expect.objectContaining({ source: "validator", numericValue: 178, experimentLog: "perf.log" }),
		});
	});

	it("extracts a boolean reading", () => {
		const out = extractKpiReadings({
			logs: [log("rollback.log", "kpi rollback_runbook: true")],
			parentKpis: [kpi("rollback_runbook", { kind: "boolean" })],
		});
		expect(out[0]?.reading.booleanValue).toBe(true);
	});

	it("extracts a rubric reading only when value is in the levels list", () => {
		const target: ProjectKpi["target"] = { kind: "rubric", levels: ["bad", "ok", "good"], minimum: "good" };
		const valid = extractKpiReadings({
			logs: [log("dx.log", "KPI dx_rating = good")],
			parentKpis: [kpi("dx_rating", target)],
		});
		expect(valid[0]?.reading.rubricValue).toBe("good");
		const invalid = extractKpiReadings({
			logs: [log("dx.log", "kpi dx_rating = excellent")],
			parentKpis: [kpi("dx_rating", target)],
		});
		expect(invalid).toEqual([]);
	});

	it("ignores lines that don't match the kpi pattern", () => {
		const out = extractKpiReadings({
			logs: [log("noise.log", "p99_latency = 178\nkpi (notes): blah\nkpi p99_latency=178")],
			parentKpis: [kpi("p99_latency", { kind: "numeric", op: "<=", value: 200 })],
		});
		// Only the third line matches.
		expect(out).toHaveLength(1);
		expect(out[0]?.reading.numericValue).toBe(178);
	});

	it("extracts JSON kpiReadings entries from .json logs", () => {
		const json = JSON.stringify({
			kpiReadings: [
				{ kpiId: "p99_latency", value: 178, note: "p99 over 10m" },
				{ kpiId: "ignored_id", value: 1 },
			],
		});
		const out = extractKpiReadings({
			logs: [log("results.json", json, ".json")],
			parentKpis: [kpi("p99_latency", { kind: "numeric", op: "<=", value: 200 })],
		});
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			kpiId: "p99_latency",
			reading: expect.objectContaining({
				source: "validator",
				numericValue: 178,
				note: "p99 over 10m",
			}),
		});
	});

	it("rejects malformed JSON silently", () => {
		const out = extractKpiReadings({
			logs: [log("results.json", "{not valid", ".json")],
			parentKpis: [kpi("p99_latency", { kind: "numeric", op: "<=", value: 200 })],
		});
		expect(out).toEqual([]);
	});

	it("uses the log mtime as recordedAt", () => {
		const out = extractKpiReadings({
			logs: [log("perf.log", "kpi p99_latency = 178")],
			parentKpis: [kpi("p99_latency", { kind: "numeric", op: "<=", value: 200 })],
		});
		expect(out[0]?.reading.recordedAt).toBe("2026-05-28T12:00:00.000Z");
	});
});
