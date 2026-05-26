import { describe, expect, it } from "vitest";

import { parseKpiMarkdownSection, serializeKpisToMarkdown } from "../../../src/workspace/kpi-markdown";
import type { ProjectKpi } from "../../../src/workspace/project-kpi";

describe("parseKpiMarkdownSection", () => {
	it("returns an empty list when no section is present", () => {
		const result = parseKpiMarkdownSection("# Roadmap\n\nSome prose.\n");
		expect(result.kpis).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it("parses a boolean target", () => {
		const md = `### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
`;
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(warnings).toEqual([]);
		expect(kpis).toHaveLength(1);
		expect(kpis[0]).toMatchObject({
			id: "rollback_runbook",
			label: "Rollback runbook published",
			target: { kind: "boolean" },
			acceptance: "manual",
			aggregate: "latest",
		});
	});

	it("parses a numeric target with op, value, and unit", () => {
		const md = `### KPIs
- id: p99_latency
  label: p99 checkout latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
`;
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(warnings).toEqual([]);
		expect(kpis[0]!.target).toEqual({ kind: "numeric", op: "<=", value: 200, unit: "ms" });
		expect(kpis[0]!.acceptance).toBe("auto-from-task");
	});

	it("parses a rubric target with pipe-separated levels", () => {
		const md = `### KPIs
- id: dx_rating
  label: Team DX rating
  target: rubric levels="bad|ok|good|great" minimum="good"
`;
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(warnings).toEqual([]);
		expect(kpis[0]!.target).toEqual({
			kind: "rubric",
			levels: ["bad", "ok", "good", "great"],
			minimum: "good",
		});
	});

	it("captures aggregate when set explicitly", () => {
		const md = `### KPIs
- id: six_checks
  label: Six structured checks
  target: numeric op=">=" value=6
  acceptance: auto-from-task
  aggregate: sum
`;
		const { kpis } = parseKpiMarkdownSection(md);
		expect(kpis[0]!.aggregate).toBe("sum");
	});

	it("parses multiple KPIs in declaration order", () => {
		const md = `### KPIs
- id: a
  label: A
  target: boolean
- id: b
  label: B
  target: boolean
- id: c
  label: C
  target: boolean
`;
		const { kpis } = parseKpiMarkdownSection(md);
		expect(kpis.map((k) => k.id)).toEqual(["a", "b", "c"]);
	});

	it("stops parsing at the next heading", () => {
		const md = `### KPIs
- id: a
  label: A
  target: boolean

### Tasks
- id: b
  label: should-not-parse
  target: boolean
`;
		const { kpis } = parseKpiMarkdownSection(md);
		expect(kpis.map((k) => k.id)).toEqual(["a"]);
	});

	it("warns and skips items that are missing required fields", () => {
		const md = `### KPIs
- id: missing_label
  target: boolean
- id: ok
  label: OK
  target: boolean
`;
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(kpis.map((k) => k.id)).toEqual(["ok"]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("missing_label");
	});

	it("warns on unknown acceptance values", () => {
		const md = `### KPIs
- id: a
  label: A
  target: boolean
  acceptance: bogus
`;
		const { warnings } = parseKpiMarkdownSection(md);
		expect(warnings.some((w) => w.includes("bogus"))).toBe(true);
	});

	it("warns on numeric op outside the allowed set", () => {
		const md = `### KPIs
- id: a
  label: A
  target: numeric op="≈" value=10
`;
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(kpis).toEqual([]);
		expect(warnings).toHaveLength(1);
	});
});

describe("serializeKpisToMarkdown", () => {
	it("returns an empty string for an empty KPI list", () => {
		expect(serializeKpisToMarkdown([])).toBe("");
	});

	it("emits the section header with each KPI block", () => {
		const kpis: ProjectKpi[] = [
			{
				id: "a",
				label: "A",
				target: { kind: "boolean" },
				acceptance: "manual",
				aggregate: "latest",
				readings: [],
			},
		];
		const md = serializeKpisToMarkdown(kpis);
		expect(md.startsWith("### KPIs\n- id: a")).toBe(true);
		expect(md).toContain("label: A");
		expect(md).toContain("target: boolean");
		// Defaults are omitted to keep the markdown terse.
		expect(md).not.toContain("acceptance: manual");
		expect(md).not.toContain("aggregate: latest");
	});

	it("emits acceptance and aggregate when non-default", () => {
		const md = serializeKpisToMarkdown([
			{
				id: "k",
				label: "K",
				target: { kind: "numeric", op: ">=", value: 6 },
				acceptance: "auto-from-task",
				aggregate: "sum",
				readings: [],
			},
		]);
		expect(md).toContain("acceptance: auto-from-task");
		expect(md).toContain("aggregate: sum");
	});

	it("round-trips numeric targets with unit", () => {
		const original: ProjectKpi[] = [
			{
				id: "p99",
				label: "p99 latency",
				target: { kind: "numeric", op: "<=", value: 200, unit: "ms" },
				acceptance: "auto-from-task",
				aggregate: "latest",
				readings: [],
			},
		];
		const md = serializeKpisToMarkdown(original);
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(warnings).toEqual([]);
		expect(kpis).toEqual(original);
	});

	it("round-trips rubric targets", () => {
		const original: ProjectKpi[] = [
			{
				id: "dx",
				label: "DX",
				target: { kind: "rubric", levels: ["bad", "ok", "good"], minimum: "good" },
				acceptance: "manual",
				aggregate: "latest",
				readings: [],
			},
		];
		const md = serializeKpisToMarkdown(original);
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(warnings).toEqual([]);
		expect(kpis).toEqual(original);
	});

	it("round-trips a mixed list with description", () => {
		const original: ProjectKpi[] = [
			{
				id: "a",
				label: "A",
				description: "first KPI",
				target: { kind: "boolean" },
				acceptance: "manual",
				aggregate: "latest",
				readings: [],
			},
			{
				id: "b",
				label: "B",
				target: { kind: "numeric", op: ">", value: 0 },
				acceptance: "auto-from-task",
				aggregate: "sum",
				readings: [],
			},
		];
		const md = serializeKpisToMarkdown(original);
		const { kpis, warnings } = parseKpiMarkdownSection(md);
		expect(warnings).toEqual([]);
		expect(kpis).toEqual(original);
	});
});
