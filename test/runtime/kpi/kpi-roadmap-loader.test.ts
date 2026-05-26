import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadProjectKpisForItem, loadSubKpisForTask } from "../../../src/workspace/kpi-roadmap-loader";
import { createTempDir } from "../../utilities/temp-dir";

describe("loadProjectKpisForItem", () => {
	it("returns an empty list when the file is missing", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-loader-");
		try {
			const result = await loadProjectKpisForItem(path, "any-id");
			expect(result.values).toEqual([]);
			expect(result.warnings).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("parses KPIs from .kanban/kpis/<itemId>.md", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-loader-");
		try {
			const dir = join(path, ".kanban", "kpis");
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, "roadmap_auth01.md"),
				`### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
- id: p99_latency
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
`,
			);
			const result = await loadProjectKpisForItem(path, "roadmap_auth01");
			expect(result.values).toHaveLength(2);
			expect(result.values[0]!.id).toBe("rollback_runbook");
			expect(result.values[1]!.acceptance).toBe("auto-from-task");
		} finally {
			cleanup();
		}
	});

	it("surfaces parse warnings without losing valid KPIs", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-loader-");
		try {
			const dir = join(path, ".kanban", "kpis");
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, "item.md"),
				`### KPIs
- id: bad
  target: numeric op="≈" value=10
- id: ok
  label: OK
  target: boolean
`,
			);
			const result = await loadProjectKpisForItem(path, "item");
			expect(result.values.map((k) => k.id)).toEqual(["ok"]);
			expect(result.warnings).toHaveLength(1);
		} finally {
			cleanup();
		}
	});
});

describe("loadSubKpisForTask", () => {
	it("returns an empty list when the file is missing", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-loader-");
		try {
			const result = await loadSubKpisForTask(path, "t_missing");
			expect(result.values).toEqual([]);
			expect(result.warnings).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("preserves parentKpiId when present in markdown", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-loader-");
		try {
			const dir = join(path, ".kanban", "kpis", "tasks");
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, "t_one.md"),
				`### KPIs
- id: sub_latency
  parentKpiId: p99_latency
  label: contributes latency
  target: numeric op="<=" value=200 unit="ms"
- id: informational
  label: just informational
  target: boolean
`,
			);
			const result = await loadSubKpisForTask(path, "t_one");
			expect(result.values).toHaveLength(2);
			expect(result.values[0]!.parentKpiId).toBe("p99_latency");
			expect(result.values[1]!.parentKpiId).toBeUndefined();
		} finally {
			cleanup();
		}
	});
});
