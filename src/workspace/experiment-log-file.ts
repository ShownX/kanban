import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/**
 * Experiment logs written by a task agent during a task. Live at
 * `.kanban/tasks/<taskId>/experiments/`. Each file is a single experiment run
 * (e.g. `2026-05-21-perf-bench.log`, `migration-dry-run.md`). The deliverable
 * panel surfaces these so reviewers can read what the agent ran.
 */

const EXPERIMENTS_DIR = ".kanban/tasks";
const EXPERIMENTS_SUBDIR = "experiments";
const SUPPORTED_EXTENSIONS = new Set([".log", ".md", ".txt", ".json"]);
const MAX_LOG_BYTES = 256 * 1024; // 256KB cap so a runaway log doesn't bloat the panel

export const experimentLogEntrySchema = z.object({
	name: z.string(),
	relativePath: z.string(),
	content: z.string(),
	mtime: z.number(),
	bytes: z.number(),
	truncated: z.boolean(),
});
export type ExperimentLogEntry = z.infer<typeof experimentLogEntrySchema>;

export function getExperimentsDirPath(workspacePath: string, taskId: string): string {
	return join(workspacePath, EXPERIMENTS_DIR, taskId, EXPERIMENTS_SUBDIR);
}

/**
 * Read all experiment log files for a task. Returns an empty array when the
 * directory does not exist. Sorted newest-first by mtime.
 */
export async function readExperimentLogs(workspacePath: string, taskId: string): Promise<ExperimentLogEntry[]> {
	const dir = getExperimentsDirPath(workspacePath, taskId);

	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const logs: ExperimentLogEntry[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const ext = extname(entry.name);
		if (ext && !SUPPORTED_EXTENSIONS.has(ext)) continue;

		const filePath = join(dir, entry.name);
		const fileStat = await stat(filePath).catch(() => null);
		if (!fileStat) continue;

		const bytes = fileStat.size;
		const truncated = bytes > MAX_LOG_BYTES;
		const raw = await readFile(filePath, "utf8").catch(() => null);
		if (raw == null) continue;

		const content = truncated
			? `${raw.slice(0, MAX_LOG_BYTES)}\n\n…[truncated, ${bytes - MAX_LOG_BYTES} more bytes]`
			: raw;

		logs.push({
			name: entry.name,
			relativePath: join(EXPERIMENTS_DIR, taskId, EXPERIMENTS_SUBDIR, entry.name),
			content,
			mtime: fileStat.mtimeMs,
			bytes,
			truncated,
		});
	}

	logs.sort((a, b) => b.mtime - a.mtime);
	return logs;
}

function extname(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot < 0) return "";
	return name.slice(dot).toLowerCase();
}
