import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/**
 * Shared memory system for multi-agent coordination.
 *
 * Manages three files under `.kanban/shared-memory/`:
 *
 * - `changelog.jsonl` — append-only event stream (gitignored, transient)
 * - `interfaces.md`   — free-form markdown defining contracts between projects (committed)
 * - `decisions.md`    — free-form markdown recording architectural decisions (committed)
 */

const SHARED_MEMORY_DIR = join(".kanban", "shared-memory");
const CHANGELOG_FILE = "changelog.jsonl";
const INTERFACES_FILE = "interfaces.md";
const DECISIONS_FILE = "decisions.md";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const changelogEventSchema = z.enum([
	"file_modified",
	"file_created",
	"decision_made",
	"interface_concern",
	"task_completed",
	"blocker_found",
]);
export type ChangelogEvent = z.infer<typeof changelogEventSchema>;

export const changelogEntrySchema = z.object({
	ts: z.string(),
	agent: z.string(),
	event: changelogEventSchema,
	files: z.array(z.string()).optional(),
	summary: z.string().optional(),
	decision: z.string().optional(),
	rationale: z.string().optional(),
	interface: z.string().optional(),
	detail: z.string().optional(),
	taskId: z.string().optional(),
	needsPmReview: z.boolean().optional(),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

/** Schema for the entry payload passed to `appendChangelog` (no `ts` field). */
export const changelogEntryInputSchema = changelogEntrySchema.omit({ ts: true });
export type ChangelogEntryInput = z.infer<typeof changelogEntryInputSchema>;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getSharedMemoryDir(workspacePath: string): string {
	return join(workspacePath, SHARED_MEMORY_DIR);
}

export function getChangelogPath(workspacePath: string): string {
	return join(workspacePath, SHARED_MEMORY_DIR, CHANGELOG_FILE);
}

export function getInterfacesPath(workspacePath: string): string {
	return join(workspacePath, SHARED_MEMORY_DIR, INTERFACES_FILE);
}

export function getDecisionsPath(workspacePath: string): string {
	return join(workspacePath, SHARED_MEMORY_DIR, DECISIONS_FILE);
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

export async function readChangelog(workspacePath: string): Promise<ChangelogEntry[]> {
	const filePath = getChangelogPath(workspacePath);
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch {
		return [];
	}
	return parseChangelogLines(raw);
}

export async function readChangelogSince(workspacePath: string, since: string): Promise<ChangelogEntry[]> {
	const all = await readChangelog(workspacePath);
	return all.filter((entry) => entry.ts >= since);
}

export async function appendChangelog(workspacePath: string, entry: ChangelogEntryInput): Promise<void> {
	const filePath = getChangelogPath(workspacePath);
	await mkdir(join(workspacePath, SHARED_MEMORY_DIR), { recursive: true });
	const full: ChangelogEntry = { ts: new Date().toISOString(), ...entry };
	await appendFile(filePath, `${JSON.stringify(full)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export async function readInterfaces(workspacePath: string): Promise<string> {
	const filePath = getInterfacesPath(workspacePath);
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return "";
	}
}

export async function writeInterfaces(workspacePath: string, content: string): Promise<void> {
	const filePath = getInterfacesPath(workspacePath);
	await mkdir(join(workspacePath, SHARED_MEMORY_DIR), { recursive: true });
	await writeFile(filePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export async function readDecisions(workspacePath: string): Promise<string> {
	const filePath = getDecisionsPath(workspacePath);
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return "";
	}
}

export async function writeDecisions(workspacePath: string, content: string): Promise<void> {
	const filePath = getDecisionsPath(workspacePath);
	await mkdir(join(workspacePath, SHARED_MEMORY_DIR), { recursive: true });
	await writeFile(filePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseChangelogLines(raw: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			const result = changelogEntrySchema.safeParse(parsed);
			if (result.success) {
				entries.push(result.data);
			}
		} catch {
			// Skip malformed lines — the file is append-only and may have
			// been partially written if a process was interrupted.
		}
	}
	return entries;
}
