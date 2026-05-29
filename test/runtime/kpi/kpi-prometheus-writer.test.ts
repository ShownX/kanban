import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeKpiPrometheusMetrics } from "../../../src/workspace/kpi-prometheus-writer";
import { createTempDir } from "../../utilities/temp-dir";

async function seedRoadmap(workspaceRoot: string, itemId: string): Promise<void> {
	const dir = join(workspaceRoot, ".kanban");
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "ROADMAP.md"),
		[
			"# Project Roadmap",
			"",
			"## Items",
			"| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |",
			"|----|-----|-------|-------------|---------------------|------|--------|-------------|",
			`| ${itemId} | | Item | desc | | | In Progress | |`,
			"",
		].join("\n"),
	);
}

async function seedKpiMd(workspaceRoot: string, itemId: string, content: string): Promise<void> {
	const dir = join(workspaceRoot, ".kanban", "kpis");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${itemId}.md`), content);
}

describe("writeKpiPrometheusMetrics", () => {
	it("writes a .prom file under .kanban/", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-prom-");
		try {
			await seedRoadmap(path, "item-a");
			await seedKpiMd(
				path,
				"item-a",
				`### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
`,
			);
			const result = await writeKpiPrometheusMetrics(path);
			expect(result.changed).toBe(true);
			expect(result.path.endsWith(".kanban/kpi-metrics.prom")).toBe(true);
			const text = await readFile(result.path, "utf8");
			expect(text).toContain("# TYPE kanban_kpi_status gauge");
			expect(text).toContain('kpi_id="rollback_runbook"');
		} finally {
			cleanup();
		}
	});

	it("returns changed=false on a no-op rewrite", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-prom-");
		try {
			await seedRoadmap(path, "item-a");
			await seedKpiMd(
				path,
				"item-a",
				`### KPIs
- id: k
  label: k
  target: boolean
`,
			);
			const first = await writeKpiPrometheusMetrics(path);
			expect(first.changed).toBe(true);
			const firstStat = await stat(first.path);
			const second = await writeKpiPrometheusMetrics(path);
			expect(second.changed).toBe(false);
			const secondStat = await stat(second.path);
			expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
		} finally {
			cleanup();
		}
	});

	it("respects the outputPath override", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-prom-");
		try {
			await seedRoadmap(path, "item-a");
			const customPath = join(path, "custom.prom");
			const result = await writeKpiPrometheusMetrics(path, { outputPath: customPath });
			expect(result.path).toBe(customPath);
			const text = await readFile(customPath, "utf8");
			expect(text).toContain("kanban_kpi_workspace_total");
		} finally {
			cleanup();
		}
	});

	it("uses the workspace label override", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-prom-");
		try {
			await seedRoadmap(path, "item-a");
			const result = await writeKpiPrometheusMetrics(path, { workspaceLabel: "team_alpha" });
			const text = await readFile(result.path, "utf8");
			expect(text).toContain('workspace="team_alpha"');
		} finally {
			cleanup();
		}
	});

	it("emits a workspace_total of 0 for a workspace with no KPIs declared", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-prom-");
		try {
			const result = await writeKpiPrometheusMetrics(path);
			const text = await readFile(result.path, "utf8");
			expect(text).toMatch(/kanban_kpi_workspace_total\{[^}]*\} 0/);
		} finally {
			cleanup();
		}
	});
});
