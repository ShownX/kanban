/**
 * Tests for the recorder that wraps each KPI mutation with event-log
 * emission. Covers the four-step pattern from the Phase C design:
 * read prior status, mutate, read new status, emit a status_changed
 * only when the resolved status flipped.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readKpiEvents } from "../../../src/workspace/kpi-event-log";
import {
	recordKpiOverrideCleared,
	recordKpiOverrideSet,
	recordKpiReading,
	recordSubKpiReading,
} from "../../../src/workspace/kpi-event-recorder";
import { readKpiStateFile } from "../../../src/workspace/kpi-state-file";
import { createTempDir } from "../../utilities/temp-dir";

const ITEM_ID = "roadmap_perf01";
const KPI_ID = "p99_latency";

async function seedItemKpi(workspaceRoot: string, content: string): Promise<void> {
	const dir = join(workspaceRoot, ".kanban", "kpis");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${ITEM_ID}.md`), content);
}

async function seedTaskSubKpi(workspaceRoot: string, taskId: string, content: string): Promise<void> {
	const dir = join(workspaceRoot, ".kanban", "kpis", "tasks");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${taskId}.md`), content);
}

const NUMERIC_KPI_MD = `### KPIs
- id: ${KPI_ID}
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
`;

describe("recordKpiReading", () => {
	it("emits reading_appended + status_changed when the reading flips status", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-recorder-");
		try {
			await seedItemKpi(path, NUMERIC_KPI_MD);
			await recordKpiReading({
				workspaceRoot: path,
				itemId: ITEM_ID,
				kpiId: KPI_ID,
				reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "manual", numericValue: 178 },
			});
			const events = await readKpiEvents(path);
			expect(events.map((e) => e.type)).toEqual(["reading_appended", "status_changed"]);
			expect(events[1]!.statusFrom).toBe("open");
			expect(events[1]!.statusTo).toBe("met");
			// Reading still made it into kpi-state.json.
			const state = await readKpiStateFile(path);
			expect(state.items[ITEM_ID]?.kpis[KPI_ID]?.readings).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("emits only reading_appended when status doesn't change", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-recorder-");
		try {
			await seedItemKpi(path, NUMERIC_KPI_MD);
			// First reading flips open -> met.
			await recordKpiReading({
				workspaceRoot: path,
				itemId: ITEM_ID,
				kpiId: KPI_ID,
				reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "manual", numericValue: 150 },
			});
			// Second reading also met; status stays met.
			await recordKpiReading({
				workspaceRoot: path,
				itemId: ITEM_ID,
				kpiId: KPI_ID,
				reading: { recordedAt: "2026-05-28T13:00:00.000Z", source: "manual", numericValue: 178 },
			});
			const events = await readKpiEvents(path);
			expect(events.map((e) => e.type)).toEqual(["reading_appended", "status_changed", "reading_appended"]);
		} finally {
			cleanup();
		}
	});

	it("does not emit when the KPI definition is missing", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-recorder-");
		try {
			// No markdown declaration.
			await recordKpiReading({
				workspaceRoot: path,
				itemId: ITEM_ID,
				kpiId: KPI_ID,
				reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "manual", numericValue: 178 },
			});
			const events = await readKpiEvents(path);
			// reading_appended still emitted (state was mutated), but no status_changed.
			expect(events.map((e) => e.type)).toEqual(["reading_appended"]);
		} finally {
			cleanup();
		}
	});
});

describe("recordSubKpiReading", () => {
	it("emits an event scoped to task/subKpi with status transition", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-recorder-");
		try {
			await seedTaskSubKpi(
				path,
				"t_perf01",
				`### KPIs
- id: sub_latency
  parentKpiId: ${KPI_ID}
  label: contributes latency
  target: numeric op="<=" value=200 unit="ms"
`,
			);
			await recordSubKpiReading({
				workspaceRoot: path,
				taskId: "t_perf01",
				subKpiId: "sub_latency",
				reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "task", numericValue: 178 },
			});
			const events = await readKpiEvents(path);
			expect(events).toHaveLength(2);
			expect(events[0]!.scope).toEqual({ kind: "task", taskId: "t_perf01", subKpiId: "sub_latency" });
			expect(events[1]!.statusTo).toBe("met");
		} finally {
			cleanup();
		}
	});
});

describe("recordKpiOverrideSet / Cleared", () => {
	it("emits override_set + status_changed when the override flips status", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-recorder-");
		try {
			await seedItemKpi(path, NUMERIC_KPI_MD);
			await recordKpiOverrideSet({
				workspaceRoot: path,
				itemId: ITEM_ID,
				kpiId: KPI_ID,
				override: {
					status: "waived",
					reason: "out of scope",
					reviewer: "alice",
					decidedAt: "2026-05-28T12:00:00.000Z",
				},
			});
			const events = await readKpiEvents(path);
			expect(events.map((e) => e.type)).toEqual(["override_set", "status_changed"]);
			expect(events[1]!.statusFrom).toBe("open");
			expect(events[1]!.statusTo).toBe("waived");
		} finally {
			cleanup();
		}
	});

	it("emits override_cleared + status_changed back to open", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-recorder-");
		try {
			await seedItemKpi(path, NUMERIC_KPI_MD);
			await recordKpiOverrideSet({
				workspaceRoot: path,
				itemId: ITEM_ID,
				kpiId: KPI_ID,
				override: {
					status: "waived",
					reason: "out of scope",
					reviewer: "alice",
					decidedAt: "2026-05-28T12:00:00.000Z",
				},
			});
			await recordKpiOverrideCleared({ workspaceRoot: path, itemId: ITEM_ID, kpiId: KPI_ID });
			const events = await readKpiEvents(path);
			const types = events.map((e) => e.type);
			expect(types).toEqual(["override_set", "status_changed", "override_cleared", "status_changed"]);
			expect(events[3]!.statusFrom).toBe("waived");
			expect(events[3]!.statusTo).toBe("open");
		} finally {
			cleanup();
		}
	});
});
