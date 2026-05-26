/**
 * Integration tests for the `kpi_coverage` validator check.
 *
 * Exercises the full path: a roadmap KPI markdown file on disk, sub-KPI
 * markdown for a task, the validator's `runKpiCoverageCheck` adapter,
 * and the resulting check entry in the validation report.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateDeliverable } from "../../../src/workspace/validator";
import { createTempDir } from "../../utilities/temp-dir";

async function seedWorkspaceForCheck(args: {
	workspaceRoot: string;
	roadmapItemId: string;
	taskId: string;
	specSlug: string;
	itemKpisMd?: string;
	taskSubKpisMd?: string;
}): Promise<void> {
	const kpiDir = join(args.workspaceRoot, ".kanban", "kpis");
	await mkdir(kpiDir, { recursive: true });
	if (args.itemKpisMd) {
		await writeFile(join(kpiDir, `${args.roadmapItemId}.md`), args.itemKpisMd);
	}
	if (args.taskSubKpisMd) {
		const tasksDir = join(kpiDir, "tasks");
		await mkdir(tasksDir, { recursive: true });
		await writeFile(join(tasksDir, `${args.taskId}.md`), args.taskSubKpisMd);
	}
	// Minimal deliverable so the other validator checks don't crash.
	const deliverableDir = join(args.workspaceRoot, ".kanban", "deliverables");
	await mkdir(deliverableDir, { recursive: true });
	await writeFile(
		join(deliverableDir, `${args.taskId}.md`),
		[
			"# Deliverable",
			"",
			"## Summary",
			"Test deliverable.",
			"",
			"## Requirements Met",
			"- All required.",
			"",
			"## Scope",
			"Files: src/foo.ts.",
			"",
			"## Spec Version",
			"1",
		].join("\n"),
	);
}

const ITEM_WITH_AUTO_KPI = `### KPIs
- id: p99_latency
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
`;

describe("validateDeliverable — kpi_coverage check", () => {
	it("passes vacuously when the roadmap item declares no KPIs", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-validator-");
		try {
			const report = await validateDeliverable({
				workspacePath: path,
				taskId: "t_one",
				specSlug: "auth",
				roadmapItemId: "roadmap_auth01",
				ownedPaths: ["src/foo.ts"],
			});
			const kpi = report.checks.find((c) => c.check === "kpi_coverage");
			expect(kpi).toBeDefined();
			expect(kpi!.status).toBe("pass");
		} finally {
			cleanup();
		}
	});

	it("passes vacuously when no roadmap item id is provided", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-validator-");
		try {
			const report = await validateDeliverable({
				workspacePath: path,
				taskId: "t_one",
				specSlug: "auth",
				roadmapItemId: "",
				ownedPaths: [],
			});
			const kpi = report.checks.find((c) => c.check === "kpi_coverage");
			expect(kpi!.status).toBe("pass");
			expect(kpi!.details).toContain("no roadmap item");
		} finally {
			cleanup();
		}
	});

	it("flags an auto-from-task KPI without a contributing sub-KPI as needs_review", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-validator-");
		try {
			await seedWorkspaceForCheck({
				workspaceRoot: path,
				roadmapItemId: "roadmap_auth01",
				taskId: "t_one",
				specSlug: "auth",
				itemKpisMd: ITEM_WITH_AUTO_KPI,
			});
			const report = await validateDeliverable({
				workspacePath: path,
				taskId: "t_one",
				specSlug: "auth",
				roadmapItemId: "roadmap_auth01",
				ownedPaths: ["src/foo.ts"],
			});
			const kpi = report.checks.find((c) => c.check === "kpi_coverage");
			expect(kpi!.status).toBe("needs_review");
			expect(kpi!.details).toContain("p99_latency");
		} finally {
			cleanup();
		}
	});

	it("passes when a linked task has a matching sub-KPI", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-validator-");
		try {
			await seedWorkspaceForCheck({
				workspaceRoot: path,
				roadmapItemId: "roadmap_auth01",
				taskId: "t_one",
				specSlug: "auth",
				itemKpisMd: ITEM_WITH_AUTO_KPI,
				taskSubKpisMd: `### KPIs
- id: sub_latency
  parentKpiId: p99_latency
  label: contribute latency reading
  target: numeric op="<=" value=200 unit="ms"
`,
			});
			// Seed a sub-KPI reading so the check has something to find.
			const stateDir = join(path, ".kanban");
			await mkdir(stateDir, { recursive: true });
			await writeFile(
				join(stateDir, "kpi-state.json"),
				JSON.stringify({
					schemaVersion: 1,
					items: {},
					tasks: {
						t_one: {
							subKpis: {
								sub_latency: {
									readings: [
										{
											recordedAt: "2026-05-24T12:00:00.000Z",
											source: "task",
											numericValue: 178,
										},
									],
								},
							},
						},
					},
				}),
			);
			const report = await validateDeliverable({
				workspacePath: path,
				taskId: "t_one",
				specSlug: "auth",
				roadmapItemId: "roadmap_auth01",
				ownedPaths: ["src/foo.ts"],
			});
			// `kpi_coverage` only inspects the markdown definition, not the
			// state-file readings — but the loader doesn't synthesize readings
			// either, so we expect needs_review when no sub-KPI markdown carries
			// readings inline. (Phase B branch 2's rollup is the path that
			// fills readings; the markdown loader returns empty arrays.)
			const kpi = report.checks.find((c) => c.check === "kpi_coverage");
			expect(kpi).toBeDefined();
			// Sub-KPI exists with parentKpiId, but no readings in the markdown
			// → check correctly flags it.
			expect(kpi!.status).toBe("needs_review");
		} finally {
			cleanup();
		}
	});

	it("walks all linkedTaskIds when supplied, not just the current task", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-validator-");
		try {
			await seedWorkspaceForCheck({
				workspaceRoot: path,
				roadmapItemId: "roadmap_auth01",
				taskId: "t_one",
				specSlug: "auth",
				itemKpisMd: ITEM_WITH_AUTO_KPI,
			});
			const report = await validateDeliverable({
				workspacePath: path,
				taskId: "t_one",
				specSlug: "auth",
				roadmapItemId: "roadmap_auth01",
				ownedPaths: ["src/foo.ts"],
				linkedTaskIds: ["t_one", "t_two", "t_three"],
			});
			// No sub-KPI markdown for any task → still needs_review.
			const kpi = report.checks.find((c) => c.check === "kpi_coverage");
			expect(kpi!.status).toBe("needs_review");
		} finally {
			cleanup();
		}
	});
});
