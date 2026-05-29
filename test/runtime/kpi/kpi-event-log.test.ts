import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appendKpiEvents, readKpiEvents, verifyKpiEventChain } from "../../../src/workspace/kpi-event-log";
import { createTempDir } from "../../utilities/temp-dir";

describe("appendKpiEvents", () => {
	it("creates the file and writes a single event with seq=1", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			const written = await appendKpiEvents(path, [
				{
					type: "reading_appended",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "manual", booleanValue: true },
				},
			]);
			expect(written).toHaveLength(1);
			expect(written[0]!.seq).toBe(1);
			expect(written[0]!.prevHash).toBe("0");
			expect(written[0]!.chainHash).not.toBe("0");
			const reread = await readKpiEvents(path);
			expect(reread).toEqual(written);
		} finally {
			cleanup();
		}
	});

	it("links seq, prevHash, and chainHash across calls", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			const [first] = await appendKpiEvents(path, [
				{ type: "override_cleared", scope: { kind: "project", itemId: "i", kpiId: "k" } },
			]);
			const [second] = await appendKpiEvents(path, [
				{
					type: "override_cleared",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
				},
			]);
			expect(second!.seq).toBe(2);
			expect(second!.prevHash).toBe(first!.chainHash);
		} finally {
			cleanup();
		}
	});

	it("writes multiple events from one call atomically", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			const written = await appendKpiEvents(path, [
				{
					type: "reading_appended",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "manual", booleanValue: true },
				},
				{
					type: "status_changed",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					statusFrom: "open",
					statusTo: "met",
				},
			]);
			expect(written.map((e) => e.seq)).toEqual([1, 2]);
			expect(written[1]!.prevHash).toBe(written[0]!.chainHash);
		} finally {
			cleanup();
		}
	});
});

describe("verifyKpiEventChain", () => {
	it("returns ok with count for an intact chain", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			await appendKpiEvents(path, [
				{
					type: "reading_appended",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					reading: { recordedAt: "2026-05-28T12:00:00.000Z", source: "manual", booleanValue: true },
				},
				{
					type: "status_changed",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					statusFrom: "open",
					statusTo: "met",
				},
			]);
			const result = await verifyKpiEventChain(path);
			expect(result).toEqual({ ok: true, count: 2 });
		} finally {
			cleanup();
		}
	});

	it("returns ok=true for an empty file", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			expect(await verifyKpiEventChain(path)).toEqual({ ok: true, count: 0 });
		} finally {
			cleanup();
		}
	});

	it("flags a tampered chainHash", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			await appendKpiEvents(path, [
				{ type: "override_cleared", scope: { kind: "project", itemId: "i", kpiId: "k" } },
				{ type: "override_cleared", scope: { kind: "project", itemId: "i", kpiId: "k" } },
			]);
			const file = join(path, ".kanban", "kpi-events.jsonl");
			const raw = await readFile(file, "utf8");
			const lines = raw.trim().split("\n");
			const second = JSON.parse(lines[1]!);
			second.chainHash = "ff".repeat(32);
			lines[1] = JSON.stringify(second);
			await writeFile(file, `${lines.join("\n")}\n`);
			const result = await verifyKpiEventChain(path);
			expect(result).toEqual(expect.objectContaining({ ok: false, index: 1 }));
		} finally {
			cleanup();
		}
	});

	it("flags an out-of-order seq", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-events-");
		try {
			await mkdir(join(path, ".kanban"), { recursive: true });
			// Hand-craft entries with the wrong seq order.
			const entries = [
				{
					seq: 2,
					ts: "2026-05-28T12:00:00.000Z",
					type: "override_cleared",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					prevHash: "0",
					chainHash: "deadbeef",
				},
			];
			await appendFile(
				join(path, ".kanban", "kpi-events.jsonl"),
				`${entries.map((e) => JSON.stringify(e)).join("\n")}\n`,
				"utf8",
			);
			const result = await verifyKpiEventChain(path);
			expect(result).toEqual(expect.objectContaining({ ok: false, index: 0 }));
		} finally {
			cleanup();
		}
	});
});
