/**
 * End-to-end test for the auto-from-task rollup: when a reviewer
 * accepts a task validation, sub-KPI readings on that task should fold
 * into the parent project KPI's readings array.
 *
 * Without this wiring, "acceptance: auto-from-task" KPIs would never
 * gain readings without manual `kanban kpi record` calls — defeating
 * the design's central automation promise.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appendSubKpiReading, readKpiStateFile } from "../../../src/workspace/kpi-state-file";
import { recordValidationResult, reviewValidation } from "../../../src/workspace/validation-lifecycle";
import { createTempDir } from "../../utilities/temp-dir";

const ITEM_ID = "roadmap_perf01";
const TASK_ID = "t_perf01";
const PARENT_KPI_ID = "p99_latency";
const SUB_KPI_ID = "sub_latency";

async function seedItemKpi(workspaceRoot: string, content: string): Promise<void> {
	const dir = join(workspaceRoot, ".kanban", "kpis");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${ITEM_ID}.md`), content);
}

async function seedTaskSubKpi(workspaceRoot: string, content: string): Promise<void> {
	const dir = join(workspaceRoot, ".kanban", "kpis", "tasks");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${TASK_ID}.md`), content);
}

async function seedAndAccept(workspacePath: string): Promise<void> {
	const validatedAt = "2026-05-26T12:00:00.000Z";
	await recordValidationResult(workspacePath, ITEM_ID, TASK_ID, "pass", validatedAt);
	await reviewValidation(workspacePath, ITEM_ID, TASK_ID, "accepted");
}

describe("reviewValidation — sub-KPI rollup on accept", () => {
	it("folds the latest sub-KPI reading into the parent project KPI", async () => {
		const { path, cleanup } = createTempDir("kanban-rollup-on-accept-");
		try {
			await seedItemKpi(
				path,
				`### KPIs
- id: ${PARENT_KPI_ID}
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
`,
			);
			await seedTaskSubKpi(
				path,
				`### KPIs
- id: ${SUB_KPI_ID}
  parentKpiId: ${PARENT_KPI_ID}
  label: contributes latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);
			await appendSubKpiReading(path, {
				taskId: TASK_ID,
				subKpiId: SUB_KPI_ID,
				reading: {
					recordedAt: "2026-05-26T11:00:00.000Z",
					source: "task",
					numericValue: 178,
					note: "p99 over 10 minutes",
				},
			});

			await seedAndAccept(path);

			const state = await readKpiStateFile(path);
			const parentReadings = state.items[ITEM_ID]?.kpis[PARENT_KPI_ID]?.readings ?? [];
			expect(parentReadings).toHaveLength(1);
			expect(parentReadings[0]).toMatchObject({
				source: "task",
				taskId: TASK_ID,
				numericValue: 178,
				note: "p99 over 10 minutes",
			});
		} finally {
			cleanup();
		}
	});

	it("does nothing on accept when the parent acceptance is manual", async () => {
		const { path, cleanup } = createTempDir("kanban-rollup-on-accept-");
		try {
			await seedItemKpi(
				path,
				`### KPIs
- id: ${PARENT_KPI_ID}
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);
			await seedTaskSubKpi(
				path,
				`### KPIs
- id: ${SUB_KPI_ID}
  parentKpiId: ${PARENT_KPI_ID}
  label: contributes latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);
			await appendSubKpiReading(path, {
				taskId: TASK_ID,
				subKpiId: SUB_KPI_ID,
				reading: { recordedAt: "2026-05-26T11:00:00.000Z", source: "task", numericValue: 178 },
			});

			await seedAndAccept(path);

			const state = await readKpiStateFile(path);
			expect(state.items[ITEM_ID]?.kpis[PARENT_KPI_ID]?.readings ?? []).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("does nothing on accept when the sub-KPI has no readings", async () => {
		const { path, cleanup } = createTempDir("kanban-rollup-on-accept-");
		try {
			await seedItemKpi(
				path,
				`### KPIs
- id: ${PARENT_KPI_ID}
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
`,
			);
			await seedTaskSubKpi(
				path,
				`### KPIs
- id: ${SUB_KPI_ID}
  parentKpiId: ${PARENT_KPI_ID}
  label: contributes latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);

			await seedAndAccept(path);

			const state = await readKpiStateFile(path);
			expect(state.items[ITEM_ID]?.kpis[PARENT_KPI_ID]?.readings ?? []).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("does not roll up on rejection", async () => {
		const { path, cleanup } = createTempDir("kanban-rollup-on-accept-");
		try {
			await seedItemKpi(
				path,
				`### KPIs
- id: ${PARENT_KPI_ID}
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
`,
			);
			await seedTaskSubKpi(
				path,
				`### KPIs
- id: ${SUB_KPI_ID}
  parentKpiId: ${PARENT_KPI_ID}
  label: contributes latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);
			await appendSubKpiReading(path, {
				taskId: TASK_ID,
				subKpiId: SUB_KPI_ID,
				reading: { recordedAt: "2026-05-26T11:00:00.000Z", source: "task", numericValue: 178 },
			});

			const validatedAt = "2026-05-26T12:00:00.000Z";
			await recordValidationResult(path, ITEM_ID, TASK_ID, "needs_review", validatedAt);
			await reviewValidation(path, ITEM_ID, TASK_ID, "rejected", "scope concerns");

			const state = await readKpiStateFile(path);
			expect(state.items[ITEM_ID]?.kpis[PARENT_KPI_ID]?.readings ?? []).toEqual([]);
		} finally {
			cleanup();
		}
	});
});
