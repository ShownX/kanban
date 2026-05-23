import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { lockedFileSystem } from "./locked-file-system.js";

/**
 * Append a single JSON record to a JSONL file under an exclusive file lock.
 *
 * Multi-agent cooperation often funnels writes into shared append-only logs
 * (e.g., a shared changelog, an activity audit). When two agents append
 * concurrently the writes can interleave and produce a malformed line. This
 * helper serializes appends through the same lock primitive used elsewhere
 * in the codebase, so concurrent processes (a kanban runtime + an agent CLI)
 * can both call into it safely.
 *
 * Each appended line is followed by a newline. When the existing file does
 * not end with a newline, one is inserted before the new line so the JSONL
 * remains parseable line-by-line.
 */
export async function appendJsonLine(filePath: string, payload: unknown): Promise<void> {
	const line = `${JSON.stringify(payload)}\n`;
	await mkdir(dirname(filePath), { recursive: true });
	await lockedFileSystem.withLock({ path: filePath, type: "file" }, async () => {
		// Ensure a trailing newline before appending so we never produce
		// `…}{…}` collisions if a previous writer crashed mid-line.
		const existing = await readFileSafe(filePath);
		if (existing.length > 0 && !existing.endsWith("\n")) {
			await appendFile(filePath, "\n", "utf8");
		}
		await appendFile(filePath, line, "utf8");
	});
}

/**
 * Read a JSONL file under a shared lock and return the parsed entries.
 * Lines that fail to parse are skipped (the caller can treat the JSONL as
 * best-effort while still seeing every well-formed entry). Use this when
 * order matters and the on-disk file is the source of truth.
 */
export async function readJsonLines<T>(filePath: string): Promise<T[]> {
	const raw = await readFileSafe(filePath);
	if (!raw) return [];
	const entries: T[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			entries.push(JSON.parse(trimmed) as T);
		} catch {
			// Skip malformed lines; locked-append should normally prevent these.
		}
	}
	return entries;
}

async function readFileSafe(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return "";
		}
		throw error;
	}
}
