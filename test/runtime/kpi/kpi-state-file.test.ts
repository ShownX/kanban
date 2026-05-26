import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
	appendKpiReading,
	appendSubKpiReading,
	clearKpiOverride,
	readKpiStateFile,
	setKpiOverride,
	writeKpiStateFile,
} from "../../../src/workspace/kpi-state-file";
import { createTempDir } from "../../utilities/temp-dir";

const recordedAt = "2026-05-24T12:00:00.000Z";

describe("readKpiStateFile", () => {
	it("returns an empty store when the file is absent", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			const store = await readKpiStateFile(path);
			expect(store.schemaVersion).toBe(1);
			expect(store.items).toEqual({});
			expect(store.tasks).toEqual({});
		} finally {
			cleanup();
		}
	});

	it("round-trips a written store", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await writeKpiStateFile(path, {
				schemaVersion: 1,
				items: {
					"item-1": {
						kpis: {
							"kpi-a": {
								readings: [{ recordedAt, source: "manual", booleanValue: true }],
							},
						},
					},
				},
				tasks: {
					"task-1": {
						subKpis: {
							"sub-a": {
								readings: [{ recordedAt, source: "task", numericValue: 42 }],
							},
						},
					},
				},
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis["kpi-a"]!.readings).toHaveLength(1);
			expect(store.tasks["task-1"]!.subKpis["sub-a"]!.readings[0]!.numericValue).toBe(42);
		} finally {
			cleanup();
		}
	});
});

describe("appendKpiReading", () => {
	it("appends a reading to a fresh KPI entry", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				reading: { recordedAt, source: "manual", booleanValue: true },
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis["kpi-a"]!.readings).toEqual([
				{ recordedAt, source: "manual", booleanValue: true },
			]);
		} finally {
			cleanup();
		}
	});

	it("preserves prior readings when appending", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				reading: { recordedAt, source: "manual", numericValue: 100 },
			});
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				reading: { recordedAt: "2026-05-24T13:00:00.000Z", source: "manual", numericValue: 90 },
			});
			const store = await readKpiStateFile(path);
			const readings = store.items["item-1"]!.kpis["kpi-a"]!.readings;
			expect(readings).toHaveLength(2);
			expect(readings.map((r) => r.numericValue)).toEqual([100, 90]);
		} finally {
			cleanup();
		}
	});

	it("isolates readings per item and per KPI", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				reading: { recordedAt, source: "manual", numericValue: 1 },
			});
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-b",
				reading: { recordedAt, source: "manual", numericValue: 2 },
			});
			await appendKpiReading(path, {
				itemId: "item-2",
				kpiId: "kpi-a",
				reading: { recordedAt, source: "manual", numericValue: 3 },
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis["kpi-a"]!.readings[0]!.numericValue).toBe(1);
			expect(store.items["item-1"]!.kpis["kpi-b"]!.readings[0]!.numericValue).toBe(2);
			expect(store.items["item-2"]!.kpis["kpi-a"]!.readings[0]!.numericValue).toBe(3);
		} finally {
			cleanup();
		}
	});
});

describe("appendSubKpiReading", () => {
	it("appends to a fresh sub-KPI entry", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await appendSubKpiReading(path, {
				taskId: "task-1",
				subKpiId: "sub-a",
				reading: { recordedAt, source: "task", numericValue: 5 },
			});
			const store = await readKpiStateFile(path);
			expect(store.tasks["task-1"]!.subKpis["sub-a"]!.readings).toHaveLength(1);
		} finally {
			cleanup();
		}
	});
});

describe("setKpiOverride / clearKpiOverride", () => {
	it("sets an override and preserves existing readings", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				reading: { recordedAt, source: "manual", booleanValue: false },
			});
			await setKpiOverride(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				override: {
					status: "waived",
					reason: "out of scope",
					reviewer: "alice",
					decidedAt: recordedAt,
				},
			});
			const store = await readKpiStateFile(path);
			const entry = store.items["item-1"]!.kpis["kpi-a"]!;
			expect(entry.override?.status).toBe("waived");
			expect(entry.readings).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("clears an override leaving readings intact", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await appendKpiReading(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				reading: { recordedAt, source: "manual", booleanValue: false },
			});
			await setKpiOverride(path, {
				itemId: "item-1",
				kpiId: "kpi-a",
				override: {
					status: "met",
					reason: "manually verified",
					reviewer: "alice",
					decidedAt: recordedAt,
				},
			});
			await clearKpiOverride(path, { itemId: "item-1", kpiId: "kpi-a" });
			const store = await readKpiStateFile(path);
			const entry = store.items["item-1"]!.kpis["kpi-a"]!;
			expect(entry.override).toBeUndefined();
			expect(entry.readings).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("is a no-op when clearing an override that doesn't exist", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await clearKpiOverride(path, { itemId: "missing", kpiId: "missing" });
			const store = await readKpiStateFile(path);
			expect(store.items).toEqual({});
		} finally {
			cleanup();
		}
	});
});

describe("schema validation", () => {
	it("rejects malformed JSON on read", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-state-");
		try {
			await mkdir(`${path}/.kanban`, { recursive: true });
			await writeFile(`${path}/.kanban/kpi-state.json`, '{"items": "not an object"}');
			await expect(readKpiStateFile(path)).rejects.toThrow();
		} finally {
			cleanup();
		}
	});
});
