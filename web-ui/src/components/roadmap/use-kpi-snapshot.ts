/**
 * Fetch the KPI snapshot for a single roadmap item via tRPC.
 *
 * Snapshot = definition (from .kanban/kpis/<itemId>.md) + readings/override
 * (from .kanban/kpi-state.json) + per-KPI evaluated status. The whole
 * shape is computed on the runtime side so the UI doesn't have to repeat
 * the engine logic.
 */

import type { RuntimeKpiSnapshot } from "@runtime-contract";
import { useCallback, useEffect, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface UseKpiSnapshotResult {
	snapshot: RuntimeKpiSnapshot | null;
	loading: boolean;
	error: string | null;
	reload: () => Promise<void>;
}

export function useKpiSnapshot(roadmapItemId: string | null, workspaceId: string | null): UseKpiSnapshotResult {
	const [snapshot, setSnapshot] = useState<RuntimeKpiSnapshot | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		if (!roadmapItemId) {
			setSnapshot(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			const next = await trpc.runtime.getKpiSnapshot.query({ roadmapItemId });
			setSnapshot(next);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [roadmapItemId, workspaceId]);

	useEffect(() => {
		void reload();
	}, [reload]);

	return { snapshot, loading, error, reload };
}
