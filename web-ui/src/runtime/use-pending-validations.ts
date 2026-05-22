import type { RuntimeAppRouter } from "@runtime-trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

type RouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
export type PendingValidation = RouterOutputs["runtime"]["getPendingValidations"][number];

/**
 * Live-ish view of pending (un-reviewed) validations across the workspace.
 * Returns a map keyed by taskId so board cards can show pass/fail/needs_review
 * badges at-a-glance. Refetches whenever the runtime fires a
 * task_ready_for_review event for the workspace.
 */
export function usePendingValidations(
	workspaceId: string | null,
	refreshToken: number | null | undefined,
): Record<string, PendingValidation> {
	const [validationsByTaskId, setValidationsByTaskId] = useState<Record<string, PendingValidation>>({});
	const isMountedRef = useRef(true);

	const fetchData = useCallback(() => {
		if (!workspaceId) {
			setValidationsByTaskId({});
			return;
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		trpc.runtime.getPendingValidations
			.query()
			.then((entries) => {
				if (!isMountedRef.current) return;
				const next: Record<string, PendingValidation> = {};
				for (const entry of entries) {
					next[entry.taskId] = entry;
				}
				setValidationsByTaskId(next);
			})
			.catch(() => {
				if (isMountedRef.current) setValidationsByTaskId({});
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

	return validationsByTaskId;
}
