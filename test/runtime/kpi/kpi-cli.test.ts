import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runKpiOverride, runKpiRecord, runKpiStatus } from "../../../src/commands/kpi";
import { readKpiStateFile } from "../../../src/workspace/kpi-state-file";
import { createTempDir } from "../../utilities/temp-dir";

interface CapturedOutput {
	stdout: string[];
	exitCode: number | null;
}

function captureOutput(): { output: CapturedOutput; restore: () => void } {
	const output: CapturedOutput = { stdout: [], exitCode: null };
	const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		output.stdout.push(typeof chunk === "string" ? chunk : chunk.toString());
		return true;
	});
	const exitProxy = new Proxy(
		{},
		{
			get: () => process.exitCode,
			set: (_target, prop, value) => {
				if (prop === "exitCode") output.exitCode = value as number;
				return true;
			},
		},
	);
	const originalExit = process.exitCode;
	return {
		output,
		restore: () => {
			writeSpy.mockRestore();
			process.exitCode = originalExit;
			void exitProxy;
		},
	};
}

async function seedRoadmapItem(
	workspaceRoot: string,
	args: { itemId: string; markdown: string; fileName?: string },
): Promise<void> {
	const dir = join(workspaceRoot, ".kanban", "roadmap");
	await mkdir(dir, { recursive: true });
	const fileName = args.fileName ?? `${args.itemId}.md`;
	await writeFile(join(dir, fileName), args.markdown);
}

const SAMPLE_MARKDOWN = (id: string) => `id: ${id}
title: Test item

### KPIs
- id: rollback_runbook
  label: Rollback runbook published
  target: boolean
- id: p99_latency
  label: p99 latency
  target: numeric op="<=" value=200 unit="ms"
  acceptance: auto-from-task
`;

describe("runKpiStatus", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});
	afterEach(() => {
		process.exitCode = 0;
	});

	it("reports no items when nothing is declared", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await runKpiStatus({ workspace: path });
			expect(captured.output.stdout.join("")).toContain("No roadmap items declare KPIs");
			expect(process.exitCode).toBe(0);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("returns text snapshots and a non-zero exit when KPIs are open", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await runKpiStatus({ workspace: path });
			const out = captured.output.stdout.join("");
			expect(out).toContain("item-1");
			expect(out).toContain("rollback_runbook [open]");
			expect(out).toContain("p99_latency [open]");
			expect(process.exitCode).toBe(3);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("emits JSON when --format json is set", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await runKpiStatus({ workspace: path, format: "json" });
			const out = captured.output.stdout.join("");
			const parsed = JSON.parse(out);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed[0].itemId).toBe("item-1");
			expect(parsed[0].kpis).toHaveLength(2);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("filters to a single item when --item is set", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await seedRoadmapItem(path, { itemId: "item-2", markdown: SAMPLE_MARKDOWN("item-2") });
			await runKpiStatus({ workspace: path, item: "item-2", format: "json" });
			const parsed = JSON.parse(captured.output.stdout.join(""));
			expect(parsed).toHaveLength(1);
			expect(parsed[0].itemId).toBe("item-2");
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("rejects an unknown --item", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await expect(runKpiStatus({ workspace: path, item: "missing" })).rejects.toThrow(/not found/);
		} finally {
			captured.restore();
			cleanup();
		}
	});
});

describe("runKpiRecord", () => {
	it("appends a numeric reading", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await runKpiRecord({
				item: "item-1",
				kpi: "p99_latency",
				value: "178",
				workspace: path,
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis.p99_latency!.readings).toEqual([
				expect.objectContaining({ source: "manual", numericValue: 178 }),
			]);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("appends a boolean reading", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await runKpiRecord({
				item: "item-1",
				kpi: "rollback_runbook",
				value: "true",
				workspace: path,
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis.rollback_runbook!.readings[0]!.booleanValue).toBe(true);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("rejects a non-numeric value for a numeric KPI", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await expect(
				runKpiRecord({ item: "item-1", kpi: "p99_latency", value: "fast", workspace: path }),
			).rejects.toThrow(/Numeric KPI/);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("rejects an unknown KPI id", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await expect(runKpiRecord({ item: "item-1", kpi: "missing", value: "true", workspace: path })).rejects.toThrow(
				/not declared/,
			);
		} finally {
			captured.restore();
			cleanup();
		}
	});
});

describe("runKpiOverride", () => {
	it("applies a waived override and flips status", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await runKpiOverride({
				item: "item-1",
				kpi: "rollback_runbook",
				status: "waived",
				reason: "out of scope",
				reviewer: "alice",
				workspace: path,
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis.rollback_runbook!.override).toMatchObject({
				status: "waived",
				reason: "out of scope",
				reviewer: "alice",
			});
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("requires reason + reviewer when not clearing", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await expect(
				runKpiOverride({
					item: "item-1",
					kpi: "rollback_runbook",
					status: "met",
					workspace: path,
				}),
			).rejects.toThrow(/--reason and --reviewer/);
		} finally {
			captured.restore();
			cleanup();
		}
	});

	it("clears an existing override with --clear", async () => {
		const { path, cleanup } = createTempDir("kanban-kpi-cli-");
		const captured = captureOutput();
		try {
			await seedRoadmapItem(path, { itemId: "item-1", markdown: SAMPLE_MARKDOWN("item-1") });
			await runKpiOverride({
				item: "item-1",
				kpi: "rollback_runbook",
				status: "waived",
				reason: "x",
				reviewer: "alice",
				workspace: path,
			});
			await runKpiOverride({
				item: "item-1",
				kpi: "rollback_runbook",
				status: "open",
				clear: true,
				workspace: path,
			});
			const store = await readKpiStateFile(path);
			expect(store.items["item-1"]!.kpis.rollback_runbook!.override).toBeUndefined();
		} finally {
			captured.restore();
			cleanup();
		}
	});
});
