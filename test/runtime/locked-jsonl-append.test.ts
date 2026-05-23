import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appendJsonLine, readJsonLines } from "../../src/fs/locked-jsonl-append";

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "kanban-jsonl-"));
	return fn(dir).finally(() => {
		rmSync(dir, { recursive: true, force: true });
	});
}

describe("appendJsonLine + readJsonLines", () => {
	it("creates the file on first write", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "log.jsonl");
			await appendJsonLine(path, { hello: "world" });
			const entries = await readJsonLines<{ hello: string }>(path);
			expect(entries).toEqual([{ hello: "world" }]);
		});
	});

	it("appends each call as a new line in order", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "log.jsonl");
			await appendJsonLine(path, { i: 1 });
			await appendJsonLine(path, { i: 2 });
			await appendJsonLine(path, { i: 3 });
			const entries = await readJsonLines<{ i: number }>(path);
			expect(entries.map((e) => e.i)).toEqual([1, 2, 3]);
		});
	});

	it("inserts a newline if a prior writer crashed mid-line (no trailing newline)", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "log.jsonl");
			// Simulate a half-written previous entry: a valid JSON line with no trailing newline.
			writeFileSync(path, '{"i":1}', "utf8");
			await appendJsonLine(path, { i: 2 });
			const raw = readFileSync(path, "utf8");
			expect(raw).toBe('{"i":1}\n{"i":2}\n');
		});
	});

	it("serializes concurrent appends through the lock without interleaving", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "log.jsonl");
			// Fire many appends concurrently and confirm the resulting file has
			// exactly N parseable JSON lines, each unique. Without locking, two
			// processes' writes could collide and produce malformed JSON.
			const N = 50;
			await Promise.all(Array.from({ length: N }, (_, i) => appendJsonLine(path, { i, payload: "x".repeat(200) })));
			const entries = await readJsonLines<{ i: number; payload: string }>(path);
			expect(entries).toHaveLength(N);
			const seen = new Set(entries.map((e) => e.i));
			expect(seen.size).toBe(N);
		});
	});

	it("readJsonLines returns an empty array when the file is missing", async () => {
		await withTempDir(async (dir) => {
			const entries = await readJsonLines<unknown>(join(dir, "missing.jsonl"));
			expect(entries).toEqual([]);
		});
	});

	it("readJsonLines skips malformed lines but keeps well-formed ones", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "log.jsonl");
			writeFileSync(path, '{"a":1}\nNOT_JSON\n{"a":2}\n', "utf8");
			const entries = await readJsonLines<{ a: number }>(path);
			expect(entries).toEqual([{ a: 1 }, { a: 2 }]);
		});
	});
});
