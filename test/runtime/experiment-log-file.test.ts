import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readExperimentLogFull, readExperimentLogs } from "../../src/workspace/experiment-log-file";

function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "kanban-experiments-test-"));
	return fn(root).finally(() => {
		rmSync(root, { recursive: true, force: true });
	});
}

function makeExperimentsDir(workspacePath: string, taskId: string): string {
	const dir = join(workspacePath, ".kanban", "tasks", taskId, "experiments");
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("readExperimentLogs", () => {
	it("returns an empty array when the directory does not exist", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const logs = await readExperimentLogs(workspacePath, "t_missing");
			expect(logs).toEqual([]);
		});
	});

	it("reads supported extensions and skips others, sorted newest first", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const dir = makeExperimentsDir(workspacePath, "t_x");
			writeFileSync(join(dir, "old.log"), "older content", "utf8");
			writeFileSync(join(dir, "newer.md"), "# fresh", "utf8");
			writeFileSync(join(dir, "README.rtf"), "should be ignored", "utf8");

			// Force older.log to have an earlier mtime.
			const past = new Date(Date.now() - 60_000);
			utimesSync(join(dir, "old.log"), past, past);

			const logs = await readExperimentLogs(workspacePath, "t_x");
			expect(logs).toHaveLength(2);
			expect(logs[0]?.name).toBe("newer.md");
			expect(logs[1]?.name).toBe("old.log");
			expect(logs[0]?.truncated).toBe(false);
			expect(logs[0]?.content).toBe("# fresh");
		});
	});

	it("truncates content above the byte cap and reports the original size", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const dir = makeExperimentsDir(workspacePath, "t_big");
			const big = "x".repeat(300 * 1024);
			writeFileSync(join(dir, "big.log"), big, "utf8");

			const logs = await readExperimentLogs(workspacePath, "t_big");
			expect(logs).toHaveLength(1);
			const log = logs[0];
			if (!log) throw new Error("missing log");
			expect(log.truncated).toBe(true);
			expect(log.bytes).toBe(300 * 1024);
			expect(log.content.length).toBeGreaterThan(256 * 1024);
			expect(log.content).toContain("[truncated,");
		});
	});
});

describe("readExperimentLogFull", () => {
	it("returns full content without truncation", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const dir = makeExperimentsDir(workspacePath, "t_full");
			const big = "y".repeat(300 * 1024);
			writeFileSync(join(dir, "big.log"), big, "utf8");

			const result = await readExperimentLogFull(workspacePath, "t_full", "big.log");
			expect(result).not.toBeNull();
			if (!result) return;
			expect(result.content.length).toBe(300 * 1024);
			expect(result.truncated).toBe(false);
		});
	});

	it("refuses path traversal attempts", async () => {
		await withTempWorkspace(async (workspacePath) => {
			expect(await readExperimentLogFull(workspacePath, "t_x", "../secret")).toBeNull();
			expect(await readExperimentLogFull(workspacePath, "t_x", "..\\secret")).toBeNull();
			expect(await readExperimentLogFull(workspacePath, "t_x", "subdir/file.log")).toBeNull();
			expect(await readExperimentLogFull(workspacePath, "t_x", "")).toBeNull();
		});
	});

	it("refuses unsupported extensions", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const dir = makeExperimentsDir(workspacePath, "t_ext");
			writeFileSync(join(dir, "screenshot.png"), "PNGFAKE", "utf8");
			expect(await readExperimentLogFull(workspacePath, "t_ext", "screenshot.png")).toBeNull();
		});
	});

	it("returns null when the file does not exist", async () => {
		await withTempWorkspace(async (workspacePath) => {
			expect(await readExperimentLogFull(workspacePath, "t_x", "missing.log")).toBeNull();
		});
	});
});
