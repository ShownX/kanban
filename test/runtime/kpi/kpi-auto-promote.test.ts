/**
 * Verifies that the auto-promote rule (maybeUpdateRoadmapStatus) gates
 * promotion on KPI status as well as the existing "all linked tasks
 * accepted" requirement, per .plan/docs/kpi-tracking-design.md.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { RuntimeBoardData, RuntimeRoadmapItem } from "../../../src/core/api-contract";
import { writeKpiStateFile } from "../../../src/workspace/kpi-state-file";
import {
	maybeUpdateRoadmapStatus,
	recordValidationResult,
	reviewValidation,
} from "../../../src/workspace/validation-lifecycle";
import { createTempDir } from "../../utilities/temp-dir";

const ITEM_ID = "roadmap_auth01";

function buildBoard(): RuntimeBoardData {
	const item: RuntimeRoadmapItem = {
		id: ITEM_ID,
		title: "Auth",
		description: "",
		status: "in_progress",
		openQuestions: [],
		tasks: [{ taskId: "t_login01", title: "Login" }],
		linkedTaskIds: ["t_login01"],
		comments: [],
		createdAt: 0,
		updatedAt: 0,
	};
	return {
		columns: [],
		dependencies: [],
		roadmap: [item],
		roadmapAnnotations: [],
	};
}

async function seedRoadmapMd(workspacePath: string): Promise<void> {
	const dir = join(workspacePath, ".kanban");
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "ROADMAP.md"),
		[
			"# Project Roadmap",
			"",
			"## Items",
			"| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |",
			"|----|-----|-------|-------------|---------------------|------|--------|-------------|",
			`| ${ITEM_ID} | | Auth | desc | | | In Progress | |`,
			"",
		].join("\n"),
	);
}

async function seedAcceptedValidation(workspacePath: string): Promise<void> {
	const validatedAt = "2026-05-22T12:00:00.000Z";
	await recordValidationResult(workspacePath, ITEM_ID, "t_login01", "pass", validatedAt);
	await reviewValidation(workspacePath, ITEM_ID, "t_login01", "accepted", "looks good");
}

async function seedKpiDefinition(workspacePath: string, content: string): Promise<void> {
	const dir = join(workspacePath, ".kanban", "kpis");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${ITEM_ID}.md`), content);
}

describe("maybeUpdateRoadmapStatus — KPI gating", () => {
	it("promotes when no KPIs are declared (legacy behavior unchanged)", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-promote-");
		try {
			await seedRoadmapMd(path);
			await seedAcceptedValidation(path);
			const promoted = await maybeUpdateRoadmapStatus(path, ITEM_ID, buildBoard());
			expect(promoted).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("blocks promotion when a declared KPI has no reading", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-promote-");
		try {
			await seedRoadmapMd(path);
			await seedAcceptedValidation(path);
			await seedKpiDefinition(
				path,
				`### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
`,
			);
			const promoted = await maybeUpdateRoadmapStatus(path, ITEM_ID, buildBoard());
			expect(promoted).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("promotes once every KPI is met", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-promote-");
		try {
			await seedRoadmapMd(path);
			await seedAcceptedValidation(path);
			await seedKpiDefinition(
				path,
				`### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
`,
			);
			await writeKpiStateFile(path, {
				schemaVersion: 1,
				items: {
					[ITEM_ID]: {
						kpis: {
							rollback_runbook: {
								readings: [
									{
										recordedAt: "2026-05-24T12:00:00.000Z",
										source: "manual",
										booleanValue: true,
									},
								],
							},
						},
					},
				},
				tasks: {},
			});
			const promoted = await maybeUpdateRoadmapStatus(path, ITEM_ID, buildBoard());
			expect(promoted).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("promotes when a KPI is waived via override", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-promote-");
		try {
			await seedRoadmapMd(path);
			await seedAcceptedValidation(path);
			await seedKpiDefinition(
				path,
				`### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
`,
			);
			await writeKpiStateFile(path, {
				schemaVersion: 1,
				items: {
					[ITEM_ID]: {
						kpis: {
							rollback_runbook: {
								readings: [],
								override: {
									status: "waived",
									reason: "out of scope this cycle",
									reviewer: "alice",
									decidedAt: "2026-05-24T12:00:00.000Z",
								},
							},
						},
					},
				},
				tasks: {},
			});
			const promoted = await maybeUpdateRoadmapStatus(path, ITEM_ID, buildBoard());
			expect(promoted).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("blocks promotion when a KPI reading misses the target", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-promote-");
		try {
			await seedRoadmapMd(path);
			await seedAcceptedValidation(path);
			await seedKpiDefinition(
				path,
				`### KPIs
- id: p99_latency
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);
			await writeKpiStateFile(path, {
				schemaVersion: 1,
				items: {
					[ITEM_ID]: {
						kpis: {
							p99_latency: {
								readings: [
									{
										recordedAt: "2026-05-24T12:00:00.000Z",
										source: "manual",
										numericValue: 350,
									},
								],
							},
						},
					},
				},
				tasks: {},
			});
			const promoted = await maybeUpdateRoadmapStatus(path, ITEM_ID, buildBoard());
			expect(promoted).toBe(false);
		} finally {
			cleanup();
		}
	});
});
