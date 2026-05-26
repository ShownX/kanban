import type { RuntimeAppRouter } from "@runtime-trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

type RouterOutputs = inferRouterOutputs<RuntimeAppRouter>;

export type ChangelogEntry = RouterOutputs["runtime"]["readSharedChangelog"][number];

interface UseSharedMemoryResult {
	changelog: ChangelogEntry[];
	interfaces: string;
	decisions: string;
	isLoading: boolean;
}

const POLL_INTERVAL_MS = 5000;

export function useSharedMemory(workspaceId: string | null): UseSharedMemoryResult {
	const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
	const [interfaces, setInterfaces] = useState("");
	const [decisions, setDecisions] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const hasFetchedRef = useRef(false);

	const fetchAll = useCallback(() => {
		if (!workspaceId) return;
		const trpc = getRuntimeTrpcClient(workspaceId);

		const changelogPromise = trpc.runtime.readSharedChangelog
			.query()
			.then((entries) => {
				setChangelog(entries);
			})
			.catch(() => {});

		const interfacesPromise = trpc.runtime.readSharedInterfaces
			.query()
			.then((result) => {
				setInterfaces(result.content);
			})
			.catch(() => {});

		const decisionsPromise = trpc.runtime.readSharedDecisions
			.query()
			.then((result) => {
				setDecisions(result.content);
			})
			.catch(() => {});

		void Promise.all([changelogPromise, interfacesPromise, decisionsPromise]).then(() => {
			if (!hasFetchedRef.current) {
				hasFetchedRef.current = true;
				setIsLoading(false);
			}
		});
	}, [workspaceId]);

	useEffect(() => {
		hasFetchedRef.current = false;
		setIsLoading(true);
		fetchAll();
		const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [fetchAll]);

	return { changelog, interfaces, decisions, isLoading };
}
