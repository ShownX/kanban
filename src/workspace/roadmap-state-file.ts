import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

/**
 * Live dashboard state for roadmap items. This file is gitignored and reflects
 * transient execution state that would churn ROADMAP.md if it lived there.
 *
 * Canonical spec (title, description, acceptance criteria, human comments,
 * human-authored task list) lives in .kanban/ROADMAP.md and is committed.
 */

const ROADMAP_STATE_PATH = join(".kanban", "roadmap-state.json");

export const runtimeRoadmapAgentCommentSchema = z.object({
	id: z.string(),
	taskId: z.string(),
	text: z.string(),
	isOpenQuestion: z.boolean().optional(),
	createdAt: z.number(),
});
export type RuntimeRoadmapAgentComment = z.infer<typeof runtimeRoadmapAgentCommentSchema>;

export const runtimeRoadmapItemStateSchema = z.object({
	itemId: z.string(),
	agentCreatedTaskIds: z.array(z.string()).default([]),
	agentComments: z.array(runtimeRoadmapAgentCommentSchema).default([]),
	lastUpdatedAt: z.number(),
});
export type RuntimeRoadmapItemState = z.infer<typeof runtimeRoadmapItemStateSchema>;

export const runtimeRoadmapStateFileSchema = z.object({
	version: z.literal(1).default(1),
	itemStates: z.record(z.string(), runtimeRoadmapItemStateSchema).default({}),
});
export type RuntimeRoadmapStateFile = z.infer<typeof runtimeRoadmapStateFileSchema>;

export function getRoadmapStateFilePath(workspacePath: string): string {
	return join(workspacePath, ROADMAP_STATE_PATH);
}

const EMPTY_STATE: RuntimeRoadmapStateFile = { version: 1, itemStates: {} };

export async function readRoadmapStateFile(workspacePath: string): Promise<RuntimeRoadmapStateFile> {
	const filePath = getRoadmapStateFilePath(workspacePath);
	try {
		const raw = await readFile(filePath, "utf8");
		const parsed = JSON.parse(raw);
		return runtimeRoadmapStateFileSchema.parse(parsed);
	} catch {
		return { version: 1, itemStates: {} };
	}
}

export async function writeRoadmapStateFile(workspacePath: string, state: RuntimeRoadmapStateFile): Promise<void> {
	const filePath = getRoadmapStateFilePath(workspacePath);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function getOrCreateItemState(
	state: RuntimeRoadmapStateFile,
	itemId: string,
	now: number = Date.now(),
): RuntimeRoadmapItemState {
	const existing = state.itemStates[itemId];
	if (existing) {
		return existing;
	}
	return {
		itemId,
		agentCreatedTaskIds: [],
		agentComments: [],
		lastUpdatedAt: now,
	};
}

export function setItemState(
	state: RuntimeRoadmapStateFile,
	itemId: string,
	update: RuntimeRoadmapItemState,
): RuntimeRoadmapStateFile {
	return {
		...state,
		itemStates: {
			...state.itemStates,
			[itemId]: update,
		},
	};
}

export { EMPTY_STATE as emptyRoadmapStateFile };
