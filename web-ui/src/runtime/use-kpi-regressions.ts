/**
 * Bulk-load met -> missed regressions across every roadmap item with
 * KPI history, for the top-bar regression alert chip.
 *
 * Implemented client-side: fetch the snapshot of each roadmap item's
 * regressions list via `getKpiHistory`, then merge. Cheap because the
 * runtime caches the underlying event log read.
 */

import type { RuntimeKpiRegressionEntry } from "@runtime-contract";
import { useEffect, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface KpiRegressionItem extends RuntimeKpiRegressionEntry {
	roadmapItemId: string;
}

export function useKpiRegressions(
	workspaceId: string | null,
	roadmapItemIds: readonly string[],
	refreshToken?: number | null,
): KpiRegressionItem[] {
	const [regressions, setRegressions] = useState<KpiRegressionItem[]>([]);

	useEffect(() => {
		if (!workspaceId || roadmapItemIds.length === 0) {
			setRegressions([]);
			return;
		}
		let cancelled = false;
		const ids = [...new Set(roadmapItemIds)].sort();
		(async () => {
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				const responses = await Promise.all(
					ids.map((roadmapItemId) =>
						trpc.runtime.getKpiHistory
							.query({ roadmapItemId })
							.then((r) => ({ roadmapItemId, regressions: r.regressions })),
					),
				);
				if (cancelled) return;
				const flat: KpiRegressionItem[] = [];
				for (const { roadmapItemId, regressions: list } of responses) {
					for (const entry of list) flat.push({ roadmapItemId, ...entry });
				}
				flat.sort((a, b) => b.ts.localeCompare(a.ts));
				setRegressions(flat);
			} catch {
				if (!cancelled) setRegressions([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [workspaceId, roadmapItemIds.join("|"), refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

	return regressions;
}
