import { createTasksFromRoadmapItem, promoteAgentTasksToRoadmapItem } from "@runtime-task-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { BoardData, RoadmapItem } from "@/types";

interface UseRoadmapTasksArgs {
	board: BoardData;
	onBoardChange: (board: BoardData) => void;
	workspaceId: string | null;
}

interface UseRoadmapTasksResult {
	createTaskForItemId: string | null;
	setCreateTaskForItemId: (id: string | null) => void;
	handleCreateTasksForItem: (itemId: string, draft: { title: string; prompt: string }) => Promise<void>;
	_agentCreatedTaskIdsByItemId: Record<string, string[]>;
	_handlePromoteAgentTasks: (itemId: string, taskIds: string[]) => Promise<void>;
}

export function useRoadmapTasks({ board, onBoardChange, workspaceId }: UseRoadmapTasksArgs): UseRoadmapTasksResult {
	const [createTaskForItemId, setCreateTaskForItemId] = useState<string | null>(null);

	const resolveDefaultBaseRef = useCallback((): string => {
		for (const column of board.columns) {
			for (const card of column.cards) {
				if (card.baseRef) return card.baseRef;
			}
		}
		return "main";
	}, [board]);

	const handleCreateTasksForItem = useCallback(
		async (itemId: string, draft: { title: string; prompt: string }) => {
			if (!workspaceId) return;
			const roadmapItems = (board.roadmap ?? []) as RoadmapItem[];
			const item = roadmapItems.find((candidate) => candidate.id === itemId);
			if (!item) return;
			const result = createTasksFromRoadmapItem(
				board,
				item,
				[{ title: draft.title || undefined, prompt: draft.prompt, baseRef: resolveDefaultBaseRef() }],
				() => crypto.randomUUID(),
			);
			const nextRoadmap = roadmapItems.map((candidate) =>
				candidate.id === itemId ? result.updatedRoadmapItem : candidate,
			);
			onBoardChange({ ...result.board, roadmap: nextRoadmap });
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				await trpc.runtime.writeRoadmapFile.mutate({ items: nextRoadmap });
			} catch {
				// Best-effort — the board write already persisted the task; ROADMAP.md will
				// be updated next time the user saves the markdown.
			}
		},
		[board, onBoardChange, resolveDefaultBaseRef, workspaceId],
	);

	// Load roadmap-state.json (gitignored live dashboard state).
	const [_agentCreatedTaskIdsByItemId, setAgentCreatedTaskIdsByItemId] = useState<Record<string, string[]>>({});
	const lastStateMtimeRef = useRef<number | null>(null);
	useEffect(() => {
		if (!workspaceId) return;
		let cancelled = false;
		const applyState = (state: { itemStates: Record<string, { agentCreatedTaskIds: string[] }> }) => {
			if (cancelled) return;
			const next: Record<string, string[]> = {};
			for (const [itemId, itemState] of Object.entries(state.itemStates)) {
				next[itemId] = itemState.agentCreatedTaskIds;
			}
			setAgentCreatedTaskIdsByItemId(next);
		};
		const doFullRead = () => {
			const trpc = getRuntimeTrpcClient(workspaceId);
			void trpc.runtime.readRoadmapState
				.query()
				.then((state) => {
					lastStateMtimeRef.current = state.mtime;
					applyState(state);
				})
				.catch(() => {});
		};
		const loadState = () => {
			const trpc = getRuntimeTrpcClient(workspaceId);
			void trpc.runtime.checkRoadmapMtime
				.query()
				.then((mtimeResult) => {
					const currentMtime = mtimeResult.roadmapStateMtime;
					// Skip full read if mtime hasn't changed (and we've loaded at least once)
					if (
						lastStateMtimeRef.current !== null &&
						currentMtime !== null &&
						currentMtime === lastStateMtimeRef.current
					) {
						return;
					}
					doFullRead();
				})
				.catch(() => {
					// Fallback: if mtime check fails, do a full read
					doFullRead();
				});
		};
		loadState();
		const interval = setInterval(loadState, 3000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [workspaceId]);

	const _handlePromoteAgentTasks = useCallback(
		async (itemId: string, taskIds: string[]) => {
			if (!workspaceId || taskIds.length === 0) return;
			const roadmapItems = (board.roadmap ?? []) as RoadmapItem[];
			const item = roadmapItems.find((candidate) => candidate.id === itemId);
			if (!item) return;
			const result = promoteAgentTasksToRoadmapItem(item, board, taskIds);
			if (result.promotedTaskIds.length === 0) return;
			const nextRoadmap = roadmapItems.map((candidate) =>
				candidate.id === itemId ? result.updatedRoadmapItem : candidate,
			);
			onBoardChange({ ...board, roadmap: nextRoadmap });

			const trpc = getRuntimeTrpcClient(workspaceId);
			try {
				await trpc.runtime.writeRoadmapFile.mutate({ items: nextRoadmap });
			} catch {
				// Best-effort: markdown write may fail; state write below still helpful.
			}

			// Remove promoted task IDs from roadmap-state.json's agentCreatedTaskIds.
			try {
				const currentState = await trpc.runtime.readRoadmapState.query();
				const existingItemState = currentState.itemStates[itemId];
				const promoted = new Set(result.promotedTaskIds);
				const nextAgentCreatedTaskIds = (existingItemState?.agentCreatedTaskIds ?? []).filter(
					(taskId) => !promoted.has(taskId),
				);
				const nextItemStates = {
					...currentState.itemStates,
					[itemId]: {
						itemId,
						agentCreatedTaskIds: nextAgentCreatedTaskIds,
						agentComments: existingItemState?.agentComments ?? [],
						lastUpdatedAt: Date.now(),
					},
				};
				await trpc.runtime.writeRoadmapState.mutate({ itemStates: nextItemStates });
				setAgentCreatedTaskIdsByItemId((prev) => ({ ...prev, [itemId]: nextAgentCreatedTaskIds }));
			} catch {
				// Best-effort: the next poll will reconcile the UI from the file.
			}
		},
		[board, onBoardChange, workspaceId],
	);

	return {
		createTaskForItemId,
		setCreateTaskForItemId,
		handleCreateTasksForItem,
		_agentCreatedTaskIdsByItemId,
		_handlePromoteAgentTasks,
	};
}
