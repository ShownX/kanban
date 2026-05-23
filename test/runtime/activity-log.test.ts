import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appendActivityLogEntry, readActivityLog, verifyActivityLog } from "../../src/workspace/activity-log";

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "kanban-activity-"));
	return fn(dir).finally(() => {
		rmSync(dir, { recursive: true, force: true });
	});
}

describe("activity-log append + verify", () => {
	it("appends the first entry with prevHash=null and seq=0", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "activity.jsonl");
			const entry = await appendActivityLogEntry(path, { agent: "auth", event: "started" });
			expect(entry.seq).toBe(0);
			expect(entry.prevHash).toBeNull();
			expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	it("chains subsequent entries via prevHash", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "activity.jsonl");
			const first = await appendActivityLogEntry(path, { agent: "auth", event: "started" });
			const second = await appendActivityLogEntry(path, {
				agent: "auth",
				event: "wrote_file",
				payload: { path: "src/auth/login.ts" },
			});
			expect(second.seq).toBe(1);
			expect(second.prevHash).toBe(first.hash);
			expect(second.hash).not.toBe(first.hash);
		});
	});

	it("verify() reports OK on a clean chain", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "activity.jsonl");
			await appendActivityLogEntry(path, { agent: "auth", event: "started" });
			await appendActivityLogEntry(path, { agent: "auth", event: "step_a" });
			await appendActivityLogEntry(path, { agent: "auth", event: "step_b" });
			const result = await verifyActivityLog(path);
			expect(result.ok).toBe(true);
			expect(result.totalEntries).toBe(3);
		});
	});

	it("verify() detects a payload edit (hash mismatch)", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "activity.jsonl");
			await appendActivityLogEntry(path, { agent: "auth", event: "started" });
			await appendActivityLogEntry(path, { agent: "auth", event: "step_a" });
			// Tamper: rewrite the second entry's event but keep its hash.
			const lines = readFileSync(path, "utf8").trim().split("\n");
			const second = JSON.parse(lines[1] ?? "{}") as { event: string };
			second.event = "step_a_TAMPERED";
			lines[1] = JSON.stringify(second);
			writeFileSync(path, `${lines.join("\n")}\n`);
			const result = await verifyActivityLog(path);
			expect(result.ok).toBe(false);
			expect(result.reason).toBe("hash_mismatch");
			expect(result.firstBrokenSeq).toBe(1);
		});
	});

	it("verify() detects a deleted entry (chain_broken)", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "activity.jsonl");
			await appendActivityLogEntry(path, { agent: "auth", event: "started" });
			await appendActivityLogEntry(path, { agent: "auth", event: "step_a" });
			await appendActivityLogEntry(path, { agent: "auth", event: "step_b" });
			// Remove the middle entry.
			const lines = readFileSync(path, "utf8").trim().split("\n");
			lines.splice(1, 1);
			writeFileSync(path, `${lines.join("\n")}\n`);
			const result = await verifyActivityLog(path);
			expect(result.ok).toBe(false);
			expect(["chain_broken", "non_monotonic_seq"]).toContain(result.reason);
		});
	});

	it("verify() returns vacuously ok on an empty log", async () => {
		await withTempDir(async (dir) => {
			const result = await verifyActivityLog(join(dir, "missing.jsonl"));
			expect(result.ok).toBe(true);
			expect(result.totalEntries).toBe(0);
		});
	});

	it("readActivityLog returns the parsed entries unchanged", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "activity.jsonl");
			await appendActivityLogEntry(path, { agent: "auth", event: "started" });
			await appendActivityLogEntry(path, { agent: "auth", event: "did_thing", payload: { x: 1 } });
			const entries = await readActivityLog(path);
			expect(entries.map((e) => e.event)).toEqual(["started", "did_thing"]);
			expect(entries[1]?.payload).toEqual({ x: 1 });
		});
	});
});
