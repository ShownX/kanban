import type { RuntimeKpiHistoryResponse } from "@runtime-contract";
import { useEffect, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface UseKpiHistoryResult {
	history: RuntimeKpiHistoryResponse | null;
	loading: boolean;
	error: string | null;
	reload: () => Promise<void>;
}

/**
 * Fetch the four time-series queries (burndown / velocity / cycle time
 * / regressions) for a single roadmap item. The runtime side does the
 * computation; we just hold the result.
 */
export function useKpiHistory(
	workspaceId: string | null,
	roadmapItemId: string | null,
	refreshToken?: number | null,
): UseKpiHistoryResult {
	const [history, setHistory] = useState<RuntimeKpiHistoryResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = async () => {
		if (!workspaceId || !roadmapItemId) {
			setHistory(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			const result = await trpc.runtime.getKpiHistory.query({ roadmapItemId });
			setHistory(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void reload();
		// reload is intentionally not in deps — recreating it would loop.
	}, [workspaceId, roadmapItemId, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

	return { history, loading, error, reload };
}
