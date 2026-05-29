import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CHAIN_HASH_GENESIS, chainHash } from "../../../src/workspace/hash-chain";
import type { KpiEvent } from "../../../src/workspace/kpi-event-log";
import {
	appendKpiEvents,
	compactKpiEventLog,
	getKpiEventLogSize,
	readKpiEvents,
	verifyKpiEventChain,
} from "../../../src/workspace/kpi-event-log";
import { createTempDir } from "../../utilities/temp-dir";

async function seedRawEvents(workspaceRoot: string, events: KpiEvent[]): Promise<void> {
	const dir = join(workspaceRoot, ".kanban");
	await mkdir(dir, { recursive: true });
	const body = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
	await writeFile(join(dir, "kpi-events.jsonl"), body);
}

function buildChain(entries: Array<Omit<KpiEvent, "chainHash" | "prevHash" | "seq">>): KpiEvent[] {
	const result: KpiEvent[] = [];
	let prev = CHAIN_HASH_GENESIS;
	let seq = 1;
	for (const entry of entries) {
		const partial = { ...entry, seq, prevHash: prev };
		const hash = chainHash(prev, partial);
		result.push({ ...partial, chainHash: hash } as KpiEvent);
		prev = hash;
		seq += 1;
	}
	return result;
}

describe("compactKpiEventLog IO", () => {
	it("returns null and leaves the file untouched when nothing is eligible", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-compact-io-");
		try {
			await appendKpiEvents(path, [
				{
					type: "reading_appended",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					reading: { recordedAt: new Date().toISOString(), source: "manual", booleanValue: true },
				},
			]);
			const before = await readFile(join(path, ".kanban", "kpi-events.jsonl"), "utf8");
			const result = await compactKpiEventLog(path, { retainDays: 90 });
			expect(result).toBeNull();
			const after = await readFile(join(path, ".kanban", "kpi-events.jsonl"), "utf8");
			expect(after).toBe(before);
		} finally {
			cleanup();
		}
	});

	it("rewrites the file with a compaction marker and chain still verifies", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-compact-io-");
		try {
			const events = buildChain([
				{
					ts: "2026-04-01T10:00:00.000Z",
					type: "reading_appended",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
				},
				{
					ts: "2026-04-01T10:00:01.000Z",
					type: "status_changed",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					statusFrom: "open",
					statusTo: "met",
				},
				// Recent event so we have a "recent" tail.
				{
					ts: new Date().toISOString(),
					type: "reading_appended",
					scope: { kind: "project", itemId: "i", kpiId: "k" },
					reading: { recordedAt: new Date().toISOString(), source: "manual", numericValue: 1 },
				},
			]);
			await seedRawEvents(path, events);

			const result = await compactKpiEventLog(path, { retainDays: 30 });
			expect(result).not.toBeNull();
			expect(result!.removed).toBe(1);

			// Reread + verify.
			const reread = await readKpiEvents(path);
			expect(reread.some((e) => e.type === "chain_compacted")).toBe(true);
			const verify = await verifyKpiEventChain(path);
			expect(verify.ok).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("makes the file smaller when there's something to drop", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-compact-io-");
		try {
			// 5 reading_appended events + 5 status_changed events on the same
			// (scope, day). After compaction only the latest status_changed
			// + the marker remain.
			const oldDay = "2026-04-01";
			const events = buildChain([
				...Array.from({ length: 5 }, (_, i) => ({
					ts: `${oldDay}T10:0${i}:00.000Z`,
					type: "reading_appended" as const,
					scope: { kind: "project" as const, itemId: "i", kpiId: "k" },
					reading: { recordedAt: `${oldDay}T10:0${i}:00.000Z`, source: "manual" as const, numericValue: i },
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					ts: `${oldDay}T11:0${i}:00.000Z`,
					type: "status_changed" as const,
					scope: { kind: "project" as const, itemId: "i", kpiId: "k" },
					statusFrom: "open" as const,
					statusTo: "met" as const,
				})),
			]);
			await seedRawEvents(path, events);
			const beforeSize = (await getKpiEventLogSize(path)).bytes;
			const result = await compactKpiEventLog(path, { retainDays: 30 });
			expect(result?.removed).toBe(9); // 5 readings + 4 status_changed (latest kept)
			const afterSize = (await getKpiEventLogSize(path)).bytes;
			expect(afterSize).toBeLessThan(beforeSize);
		} finally {
			cleanup();
		}
	});
});
