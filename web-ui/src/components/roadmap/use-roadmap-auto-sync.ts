import { useEffect, useRef } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { BoardCard, BoardData, RoadmapItem, RoadmapItemStatus } from "@/types";

/** Minimum interval (ms) between consecutive ROADMAP.md writes to avoid polling loops. */
const WRITE_DEBOUNCE_MS = 5000;

interface UseRoadmapAutoSyncOptions {
	board: BoardData;
	workspaceId: string | null;
	onBoardChange: (board: BoardData) => void;
}

/**
 * Resolve all board cards whose IDs appear in the roadmap item's `linkedTaskIds`.
 * Each returned entry includes the card and the column ID it belongs to.
 */
function findLinkedCards(item: RoadmapItem, board: BoardData): Array<{ card: BoardCard; columnId: string }> {
	if (item.linkedTaskIds.length === 0) return [];
	const linkedIdSet = new Set(item.linkedTaskIds);
	const results: Array<{ card: BoardCard; columnId: string }> = [];
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (linkedIdSet.has(card.id)) {
				results.push({ card, columnId: column.id });
			}
		}
	}
	return results;
}

/**
 * Derive the roadmap item status from linked task column positions.
 * Returns `null` when the status should not be changed (no linked cards, or all in backlog).
 */
function deriveItemStatus(item: RoadmapItem, board: BoardData): RoadmapItemStatus | null {
	const linkedCards = findLinkedCards(item, board);
	if (linkedCards.length === 0) return null;

	const allDone = linkedCards.every((c) => c.columnId === "trash");
	if (allDone) return "done";

	const anyActive = linkedCards.some((c) => c.columnId === "in_progress" || c.columnId === "review");
	if (anyActive) return "in_progress";

	// All linked cards are in backlog — don't override the manual status.
	return null;
}

/**
 * Passively watches the board and auto-syncs roadmap item statuses based on
 * the column positions of their linked task cards.
 *
 * This hook produces no UI. It runs as a side effect inside the roadmap view,
 * updating `board.roadmap` and persisting changes to ROADMAP.md when a derived
 * status differs from the current one.
 */
export function useRoadmapAutoSync({ board, workspaceId, onBoardChange }: UseRoadmapAutoSyncOptions): void {
	const lastWriteTimeRef = useRef(0);
	const writingRef = useRef(false);

	useEffect(() => {
		if (!workspaceId) return;

		const roadmapItems = (board.roadmap ?? []) as RoadmapItem[];
		if (roadmapItems.length === 0) return;

		// Compute all status changes in one pass.
		let hasChanges = false;
		const updatedItems: RoadmapItem[] = roadmapItems.map((item) => {
			const derived = deriveItemStatus(item, board);
			if (derived !== null && derived !== item.status) {
				hasChanges = true;
				return { ...item, status: derived, updatedAt: Date.now() };
			}
			return item;
		});

		if (!hasChanges) return;

		// Debounce: skip if we wrote too recently or a write is in flight.
		const now = Date.now();
		if (now - lastWriteTimeRef.current < WRITE_DEBOUNCE_MS) return;
		if (writingRef.current) return;

		// Apply optimistic board update.
		onBoardChange({ ...board, roadmap: updatedItems });

		// Persist to ROADMAP.md.
		writingRef.current = true;
		lastWriteTimeRef.current = now;
		const trpc = getRuntimeTrpcClient(workspaceId);
		trpc.runtime.writeRoadmapFile
			.mutate({ items: updatedItems })
			.catch(() => {
				// Best-effort: the in-memory board is already updated; the file will
				// be reconciled on the next polling cycle or manual save.
			})
			.finally(() => {
				writingRef.current = false;
			});
	}, [board, workspaceId, onBoardChange]);
}
