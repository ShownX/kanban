/**
 * Bulk-fetch KPI rollups for the roadmap items currently visible on
 * the board. Used by the kanban-board to render M/N KPIs pills on
 * cards in the review and trash columns without per-card round trips.
 *
 * Returns a map keyed by roadmapItemId. Items with no KPIs declared
 * appear with `total: 0`; the badge component skips those.
 */

import type { RuntimeKpiRollupEntry } from "@runtime-contract";
import { useEffect, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export type KpiRollupSummary = Pick<RuntimeKpiRollupEntry, "met" | "total" | "blockingIds">;

export function useKpiRollups(
	workspaceId: string | null,
	roadmapItemIds: readonly string[],
	refreshToken?: number | null,
): Record<string, KpiRollupSummary> {
	const [rollups, setRollups] = useState<Record<string, KpiRollupSummary>>({});

	useEffect(() => {
		if (!workspaceId || roadmapItemIds.length === 0) {
			setRollups({});
			return;
		}
		let cancelled = false;
		const ids = [...new Set(roadmapItemIds)].sort();
		(async () => {
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				const result = await trpc.runtime.getKpiRollups.query({ roadmapItemIds: ids });
				if (cancelled) return;
				const next: Record<string, KpiRollupSummary> = {};
				for (const entry of result.rollups) {
					next[entry.roadmapItemId] = {
						met: entry.met,
						total: entry.total,
						blockingIds: entry.blockingIds,
					};
				}
				setRollups(next);
			} catch {
				// Silently degrade — pills just won't show. KPI panel still works.
				if (!cancelled) setRollups({});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [workspaceId, roadmapItemIds.join("|"), refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps -- joined string used as dep key

	return rollups;
}
