import type { RuntimeKpiWorkspaceDashboardResponse } from "@runtime-contract";
import { useEffect, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface UseKpiWorkspaceDashboardResult {
	dashboard: RuntimeKpiWorkspaceDashboardResponse | null;
	loading: boolean;
	error: string | null;
	reload: () => Promise<void>;
}

export function useKpiWorkspaceDashboard(
	workspaceId: string | null,
	refreshToken?: number | null,
): UseKpiWorkspaceDashboardResult {
	const [dashboard, setDashboard] = useState<RuntimeKpiWorkspaceDashboardResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = async () => {
		if (!workspaceId) {
			setDashboard(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			const result = await trpc.runtime.getKpiWorkspaceDashboard.query({});
			setDashboard(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void reload();
	}, [workspaceId, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

	return { dashboard, loading, error, reload };
}
