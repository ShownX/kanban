/**
 * `kanban kpi` CLI commands.
 *
 * Operates directly on workspace files (no runtime dependency) so it
 * doubles as a CI gate. The full set:
 *
 *   kanban kpi status [--item <id>] [--format json|text] [--workspace <path>]
 *     Snapshot per roadmap item. Exits non-zero when any KPI is
 *     `missed` or `open` (without an override) — plug into a CI step
 *     to fail the build if a KPI regression slips in.
 *
 *   kanban kpi record --item <id> --kpi <id> --value <…> [--source manual|task|validator]
 *                    [--task-id <id>] [--note <text>] [--workspace <path>]
 *     Append a reading to a project KPI. Reading shape is parsed from
 *     `--value` based on the KPI's target kind (boolean / numeric / rubric).
 *
 *   kanban kpi override --item <id> --kpi <id> --status met|waived|open|missed
 *                       --reason <text> --reviewer <name> [--workspace <path>]
 *     Apply (or replace) a manual override on a KPI. Pass
 *     `--status open` with `--clear` to remove an override.
 *
 * The roadmap markdown lookup is intentionally minimal: this branch
 * scans `.kanban/roadmap/*.md` for files containing the requested
 * item id, reads the `### KPIs` section, and joins it with state.
 * Once roadmap-panel lands, the same data is available from tRPC and
 * the CLI can short-circuit through the runtime when one is running.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { readKpiEvents, verifyKpiEventChain } from "../workspace/kpi-event-log.js";
import {
	recordKpiOverrideCleared,
	recordKpiOverrideSet,
	recordKpiReading as recordProjectKpiReading,
} from "../workspace/kpi-event-recorder.js";
import { parseKpiMarkdownSection } from "../workspace/kpi-markdown.js";
import { buildKpiSnapshot, formatSnapshotAsText, type KpiSnapshot } from "../workspace/kpi-snapshot.js";
import { readKpiStateFile } from "../workspace/kpi-state-file.js";
import type { KpiReading, KpiStatus, ProjectKpi } from "../workspace/project-kpi.js";

const ROADMAP_GLOB_DIR = ".kanban/roadmap";

interface DiscoveredItem {
	itemId: string;
	definitions: ProjectKpi[];
	sourcePath: string;
}

async function discoverRoadmapItems(workspaceRoot: string): Promise<DiscoveredItem[]> {
	const dir = join(workspaceRoot, ROADMAP_GLOB_DIR);
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
	const items: DiscoveredItem[] = [];
	for (const name of entries) {
		if (!name.endsWith(".md")) continue;
		const path = join(dir, name);
		const md = await readFile(path, "utf8");
		const itemId = extractItemId(md, name);
		if (!itemId) continue;
		const { kpis } = parseKpiMarkdownSection(md);
		items.push({ itemId, definitions: kpis, sourcePath: path });
	}
	return items;
}

function extractItemId(markdown: string, fileName: string): string | null {
	const match = markdown.match(/^id:\s*(\S+)/m);
	if (match?.[1]) return match[1];
	// Fallback: strip the `.md` and any leading numeric prefix from the filename.
	return fileName.replace(/\.md$/i, "").replace(/^\d+[-_]/, "") || null;
}

async function buildSnapshotFor(item: DiscoveredItem, workspaceRoot: string): Promise<KpiSnapshot> {
	const state = await readKpiStateFile(workspaceRoot);
	return buildKpiSnapshot({ itemId: item.itemId, definitions: item.definitions, state });
}

async function findItem(workspaceRoot: string, itemId: string): Promise<DiscoveredItem> {
	const items = await discoverRoadmapItems(workspaceRoot);
	const match = items.find((i) => i.itemId === itemId);
	if (!match) {
		throw new Error(`Roadmap item "${itemId}" not found under ${ROADMAP_GLOB_DIR}/.`);
	}
	return match;
}

function findDefinition(item: DiscoveredItem, kpiId: string): ProjectKpi {
	const def = item.definitions.find((k) => k.id === kpiId);
	if (!def) {
		throw new Error(`KPI "${kpiId}" not declared on roadmap item "${item.itemId}".`);
	}
	return def;
}

function parseReadingValue(rawValue: string, kpi: ProjectKpi): KpiReading {
	const recordedAt = new Date().toISOString();
	switch (kpi.target.kind) {
		case "boolean": {
			if (rawValue === "true") return { recordedAt, source: "manual", booleanValue: true };
			if (rawValue === "false") return { recordedAt, source: "manual", booleanValue: false };
			throw new Error(`Boolean KPI expects --value true|false; got "${rawValue}".`);
		}
		case "numeric": {
			const numeric = Number.parseFloat(rawValue);
			if (Number.isNaN(numeric)) {
				throw new Error(`Numeric KPI expects --value <number>; got "${rawValue}".`);
			}
			return { recordedAt, source: "manual", numericValue: numeric };
		}
		case "rubric": {
			if (!kpi.target.levels.includes(rawValue)) {
				throw new Error(
					`Rubric KPI expects --value to be one of ${kpi.target.levels.join(", ")}; got "${rawValue}".`,
				);
			}
			return { recordedAt, source: "manual", rubricValue: rawValue };
		}
	}
}

function exitCodeForSnapshot(snapshot: KpiSnapshot): number {
	for (const entry of snapshot.kpis) {
		if (entry.evaluation.status === "missed") return 2;
		if (entry.evaluation.status === "open") return 3;
	}
	return 0;
}

interface StatusOptions {
	item?: string;
	format?: "json" | "text";
	workspace?: string;
}

interface RecordOptions {
	item: string;
	kpi: string;
	value: string;
	source?: "manual" | "task" | "validator";
	taskId?: string;
	note?: string;
	workspace?: string;
}

interface OverrideOptions {
	item: string;
	kpi: string;
	status: KpiStatus;
	reason?: string;
	reviewer?: string;
	clear?: boolean;
	workspace?: string;
}

function parseFormat(value: string): "json" | "text" {
	if (value === "json" || value === "text") return value;
	throw new Error(`Invalid --format "${value}". Expected json or text.`);
}

function parseOverrideStatus(value: string): KpiStatus {
	if (value === "met" || value === "missed" || value === "open" || value === "waived") return value;
	throw new Error(`Invalid --status "${value}". Expected met | missed | open | waived.`);
}

function parseSource(value: string): "manual" | "task" | "validator" {
	if (value === "manual" || value === "task" || value === "validator") return value;
	throw new Error(`Invalid --source "${value}". Expected manual | task | validator.`);
}

export async function runKpiStatus(options: StatusOptions): Promise<void> {
	const workspaceRoot = resolve(options.workspace ?? process.cwd());
	const format = options.format ?? "text";
	const items = await discoverRoadmapItems(workspaceRoot);
	const targets = options.item ? items.filter((i) => i.itemId === options.item) : items;
	if (options.item && targets.length === 0) {
		throw new Error(`Roadmap item "${options.item}" not found.`);
	}
	const snapshots = await Promise.all(targets.map((item) => buildSnapshotFor(item, workspaceRoot)));

	if (format === "json") {
		process.stdout.write(`${JSON.stringify(snapshots, null, 2)}\n`);
	} else if (snapshots.length === 0) {
		process.stdout.write("No roadmap items declare KPIs.\n");
	} else {
		for (const snapshot of snapshots) {
			process.stdout.write(`${formatSnapshotAsText(snapshot)}\n`);
		}
	}
	const worstExit = snapshots.map(exitCodeForSnapshot).reduce((highest, code) => Math.max(highest, code), 0);
	if (worstExit !== 0) {
		process.exitCode = worstExit;
	}
}

export async function runKpiRecord(options: RecordOptions): Promise<void> {
	const workspaceRoot = resolve(options.workspace ?? process.cwd());
	const item = await findItem(workspaceRoot, options.item);
	const definition = findDefinition(item, options.kpi);
	const baseReading = parseReadingValue(options.value, definition);
	const reading: KpiReading = {
		...baseReading,
		source: options.source ?? "manual",
		taskId: options.taskId,
		note: options.note,
	};
	await recordProjectKpiReading({
		workspaceRoot,
		itemId: item.itemId,
		kpiId: definition.id,
		reading,
	});
	process.stdout.write(`Recorded reading on ${item.itemId} / ${definition.id}.\n`);
}

export async function runKpiOverride(options: OverrideOptions): Promise<void> {
	const workspaceRoot = resolve(options.workspace ?? process.cwd());
	const item = await findItem(workspaceRoot, options.item);
	const definition = findDefinition(item, options.kpi);
	if (options.clear) {
		await recordKpiOverrideCleared({ workspaceRoot, itemId: item.itemId, kpiId: definition.id });
		process.stdout.write(`Cleared override on ${item.itemId} / ${definition.id}.\n`);
		return;
	}
	if (!options.reason || !options.reviewer) {
		throw new Error("`kanban kpi override` requires --reason and --reviewer (unless --clear is set).");
	}
	await recordKpiOverrideSet({
		workspaceRoot,
		itemId: item.itemId,
		kpiId: definition.id,
		override: {
			status: options.status,
			reason: options.reason,
			reviewer: options.reviewer,
			decidedAt: new Date().toISOString(),
		},
	});
	process.stdout.write(`Set override (${options.status}) on ${item.itemId} / ${definition.id}.\n`);
}

interface EventsListOptions {
	item?: string;
	taskId?: string;
	since?: string;
	format?: "json" | "text";
	workspace?: string;
}

interface EventsVerifyOptions {
	workspace?: string;
}

export async function runKpiEventsList(options: EventsListOptions): Promise<void> {
	const workspaceRoot = resolve(options.workspace ?? process.cwd());
	const format = options.format ?? "text";
	const events = await readKpiEvents(workspaceRoot);
	const filtered = events.filter((event) => {
		if (options.since && event.ts < options.since) return false;
		if (options.item) {
			if (event.scope.kind !== "project" || event.scope.itemId !== options.item) return false;
		}
		if (options.taskId) {
			if (event.scope.kind !== "task" || event.scope.taskId !== options.taskId) return false;
		}
		return true;
	});
	if (format === "json") {
		process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
		return;
	}
	if (filtered.length === 0) {
		process.stdout.write("No KPI events.\n");
		return;
	}
	for (const event of filtered) {
		const scope =
			event.scope.kind === "project"
				? `${event.scope.itemId}/${event.scope.kpiId}`
				: `task:${event.scope.taskId}/${event.scope.subKpiId}`;
		const transition =
			event.statusFrom !== undefined && event.statusTo !== undefined ? ` ${event.statusFrom}→${event.statusTo}` : "";
		process.stdout.write(`#${event.seq} ${event.ts} ${event.type} ${scope}${transition}\n`);
	}
}

export async function runKpiEventsVerify(options: EventsVerifyOptions): Promise<void> {
	const workspaceRoot = resolve(options.workspace ?? process.cwd());
	const result = await verifyKpiEventChain(workspaceRoot);
	if (result.ok) {
		process.stdout.write(`Chain intact: ${result.count} event(s).\n`);
		return;
	}
	process.stdout.write(`Chain broken at index ${result.index} (line ${result.index + 1}): ${result.reason}\n`);
	process.exitCode = 4;
}

export function registerKpiCommand(program: Command): void {
	const kpi = program.command("kpi").description("Inspect and record project KPI readings.");

	kpi.command("status")
		.description("Show KPI snapshot for one or all roadmap items.")
		.option("--item <id>", "Restrict to a single roadmap item.")
		.option("--format <fmt>", "Output format: json | text.", parseFormat, "text")
		.option("--workspace <path>", "Workspace root. Defaults to current working directory.")
		.action(async (options: StatusOptions) => {
			await runKpiStatus(options);
		});

	kpi.command("record")
		.description("Append a reading to a project KPI.")
		.requiredOption("--item <id>", "Roadmap item id.")
		.requiredOption("--kpi <id>", "KPI id within the item.")
		.requiredOption("--value <value>", "Reading value (true|false / number / rubric level).")
		.option("--source <source>", "Reading source: manual | task | validator.", parseSource, "manual")
		.option("--task-id <id>", "Originating task id (for source=task).")
		.option("--note <text>", "Free-form note attached to the reading.")
		.option("--workspace <path>", "Workspace root. Defaults to current working directory.")
		.action(async (options: RecordOptions) => {
			await runKpiRecord(options);
		});

	kpi.command("override")
		.description("Apply or clear a manual override on a KPI.")
		.requiredOption("--item <id>", "Roadmap item id.")
		.requiredOption("--kpi <id>", "KPI id within the item.")
		.option("--status <status>", "New status: met | missed | open | waived.", parseOverrideStatus, "met")
		.option("--reason <text>", "Required when setting an override.")
		.option("--reviewer <name>", "Required when setting an override.")
		.option("--clear", "Remove an existing override instead of setting one.")
		.option("--workspace <path>", "Workspace root. Defaults to current working directory.")
		.action(async (options: OverrideOptions) => {
			await runKpiOverride(options);
		});

	const events = kpi.command("events").description("Inspect the KPI event log (Phase C hash-chained log).");

	events
		.command("list")
		.description("List KPI events, newest-first by default.")
		.option("--item <id>", "Restrict to a single roadmap item.")
		.option("--task-id <id>", "Restrict to a single task's sub-KPI events.")
		.option("--since <iso>", "Only events whose ts >= this ISO-8601 string.")
		.option("--format <fmt>", "Output format: json | text.", parseFormat, "text")
		.option("--workspace <path>", "Workspace root. Defaults to current working directory.")
		.action(async (options: EventsListOptions) => {
			await runKpiEventsList(options);
		});

	events
		.command("verify")
		.description("Walk the KPI event chain and report any breaks. Exits non-zero on corruption.")
		.option("--workspace <path>", "Workspace root. Defaults to current working directory.")
		.action(async (options: EventsVerifyOptions) => {
			await runKpiEventsVerify(options);
		});
}
