/**
 * KPI runtime state persisted to `.kanban/kpi-state.json`.
 *
 * Definition of which KPIs exist (label, target, acceptance, etc.)
 * lives in the committed roadmap markdown. **State** — the readings
 * each KPI has accumulated, the override a reviewer applied — lives
 * here, gitignored.
 *
 * Mirrors the split used by validation history (`## Reviews` markdown
 * vs `roadmap-state.json`): durable definition in markdown, transient
 * state in locked JSON.
 *
 * On-disk shape:
 *
 *   {
 *     "schemaVersion": 1,
 *     "items": {
 *       "<roadmapItemId>": {
 *         "kpis": { "<kpiId>": { readings, override } }
 *       }
 *     },
 *     "tasks": {
 *       "<taskId>": {
 *         "subKpis": { "<subKpiId>": { readings } }
 *       }
 *     }
 *   }
 *
 * Reads return an empty store when the file doesn't exist; writes use
 * `lockedFileSystem.writeJsonFileAtomic` so concurrent agents can
 * record readings without corrupting the file.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { lockedFileSystem } from "../fs/locked-file-system.js";
import { type KpiOverride, type KpiReading, kpiOverrideSchema, kpiReadingSchema } from "./project-kpi.js";

const KPI_STATE_FILE = "kpi-state.json";
const KANBAN_DIR = ".kanban";
const SCHEMA_VERSION = 1;

const kpiStateEntrySchema = z.object({
	readings: z.array(kpiReadingSchema).default([]),
	override: kpiOverrideSchema.optional(),
});

const subKpiStateEntrySchema = z.object({
	readings: z.array(kpiReadingSchema).default([]),
});

const kpiStateFileSchema = z.object({
	schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
	items: z
		.record(
			z.string(),
			z.object({
				kpis: z.record(z.string(), kpiStateEntrySchema).default({}),
			}),
		)
		.default({}),
	tasks: z
		.record(
			z.string(),
			z.object({
				subKpis: z.record(z.string(), subKpiStateEntrySchema).default({}),
			}),
		)
		.default({}),
});

export type KpiStateFile = z.infer<typeof kpiStateFileSchema>;
export type KpiStateEntry = z.infer<typeof kpiStateEntrySchema>;
export type SubKpiStateEntry = z.infer<typeof subKpiStateEntrySchema>;

function emptyStore(): KpiStateFile {
	return { schemaVersion: SCHEMA_VERSION, items: {}, tasks: {} };
}

function statePath(workspaceRoot: string): string {
	return join(workspaceRoot, KANBAN_DIR, KPI_STATE_FILE);
}

/** Load the KPI state file. Returns an empty store if it doesn't exist. */
export async function readKpiStateFile(workspaceRoot: string): Promise<KpiStateFile> {
	const path = statePath(workspaceRoot);
	try {
		const raw = await readFile(path, "utf8");
		const parsed = kpiStateFileSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(`Invalid kpi-state.json: ${parsed.error.message}`);
		}
		return parsed.data;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return emptyStore();
		}
		throw error;
	}
}

/** Write the KPI state file under a lock. Creates `.kanban/` if absent. */
export async function writeKpiStateFile(workspaceRoot: string, store: KpiStateFile): Promise<void> {
	const path = statePath(workspaceRoot);
	await lockedFileSystem.writeJsonFileAtomic(path, kpiStateFileSchema.parse(store));
}

/** Append a reading to a project KPI under a lock. */
export async function appendKpiReading(
	workspaceRoot: string,
	args: { itemId: string; kpiId: string; reading: KpiReading },
): Promise<void> {
	const path = statePath(workspaceRoot);
	await lockedFileSystem.withLock({ path, type: "file" }, async () => {
		const store = await readKpiStateFile(workspaceRoot);
		const item = store.items[args.itemId] ?? { kpis: {} };
		const entry = item.kpis[args.kpiId] ?? { readings: [] };
		entry.readings = [...entry.readings, args.reading];
		item.kpis[args.kpiId] = entry;
		store.items[args.itemId] = item;
		await lockedFileSystem.writeJsonFileAtomic(path, kpiStateFileSchema.parse(store), { lock: null });
	});
}

/** Append a reading to a task sub-KPI under a lock. */
export async function appendSubKpiReading(
	workspaceRoot: string,
	args: { taskId: string; subKpiId: string; reading: KpiReading },
): Promise<void> {
	const path = statePath(workspaceRoot);
	await lockedFileSystem.withLock({ path, type: "file" }, async () => {
		const store = await readKpiStateFile(workspaceRoot);
		const task = store.tasks[args.taskId] ?? { subKpis: {} };
		const entry = task.subKpis[args.subKpiId] ?? { readings: [] };
		entry.readings = [...entry.readings, args.reading];
		task.subKpis[args.subKpiId] = entry;
		store.tasks[args.taskId] = task;
		await lockedFileSystem.writeJsonFileAtomic(path, kpiStateFileSchema.parse(store), { lock: null });
	});
}

/** Set the override on a project KPI under a lock. */
export async function setKpiOverride(
	workspaceRoot: string,
	args: { itemId: string; kpiId: string; override: KpiOverride },
): Promise<void> {
	const path = statePath(workspaceRoot);
	await lockedFileSystem.withLock({ path, type: "file" }, async () => {
		const store = await readKpiStateFile(workspaceRoot);
		const item = store.items[args.itemId] ?? { kpis: {} };
		const entry = item.kpis[args.kpiId] ?? { readings: [] };
		entry.override = args.override;
		item.kpis[args.kpiId] = entry;
		store.items[args.itemId] = item;
		await lockedFileSystem.writeJsonFileAtomic(path, kpiStateFileSchema.parse(store), { lock: null });
	});
}

/** Remove the override on a project KPI under a lock. */
export async function clearKpiOverride(workspaceRoot: string, args: { itemId: string; kpiId: string }): Promise<void> {
	const path = statePath(workspaceRoot);
	await lockedFileSystem.withLock({ path, type: "file" }, async () => {
		const store = await readKpiStateFile(workspaceRoot);
		const item = store.items[args.itemId];
		if (!item) return;
		const entry = item.kpis[args.kpiId];
		if (!entry) return;
		entry.override = undefined;
		item.kpis[args.kpiId] = entry;
		store.items[args.itemId] = item;
		await lockedFileSystem.writeJsonFileAtomic(path, kpiStateFileSchema.parse(store), { lock: null });
	});
}
