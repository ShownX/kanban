import type { RuntimeAppRouter } from "@runtime-trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

type RouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
export type LatestValidationPerTask = RouterOutputs["runtime"]["getLatestValidationsPerTask"][number];

/**
 * Live-ish view of the latest validation entry per task (reviewed or not).
 * Backs board card badges in any column — review cards show the validator's
 * reportResult, done cards show the reviewer's outcome. Refetches whenever
 * the runtime fires a task_ready_for_review event for the workspace.
 */
export function useLatestValidations(
	workspaceId: string | null,
	refreshToken: number | null | undefined,
): Record<string, LatestValidationPerTask> {
	const [latestByTaskId, setLatestByTaskId] = useState<Record<string, LatestValidationPerTask>>({});
	const isMountedRef = useRef(true);

	const fetchData = useCallback(() => {
		if (!workspaceId) {
			setLatestByTaskId({});
			return;
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		trpc.runtime.getLatestValidationsPerTask
			.query()
			.then((entries) => {
				if (!isMountedRef.current) return;
				const next: Record<string, LatestValidationPerTask> = {};
				for (const entry of entries) {
					next[entry.taskId] = entry;
				}
				setLatestByTaskId(next);
			})
			.catch(() => {
				if (isMountedRef.current) setLatestByTaskId({});
			});
	}, [workspaceId]);

	useEffect(() => {
		isMountedRef.current = true;
		fetchData();
		return () => {
			isMountedRef.current = false;
		};
	}, [fetchData]);

	useEffect(() => {
		if (refreshToken == null) return;
		fetchData();
	}, [refreshToken, fetchData]);

	return latestByTaskId;
}
