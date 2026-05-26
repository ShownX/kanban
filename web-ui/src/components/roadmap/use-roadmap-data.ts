import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RoadmapItem } from "@/types";

interface UseRoadmapDataResult {
	markdown: string;
	setMarkdown: (value: string | ((prev: string) => string)) => void;
	parsedItems: RoadmapItem[];
	loadFile: () => void;
}

export function useRoadmapData(workspaceId: string | null): UseRoadmapDataResult {
	const [markdown, setMarkdown] = useState("");
	const [parsedItems, setParsedItems] = useState<RoadmapItem[]>([]);
	const lastParsedContentRef = useRef("");
	const lastRoadmapFileMtimeRef = useRef<number | null>(null);

	const loadFile = useCallback(() => {
		if (!workspaceId) return;
		const trpc = getRuntimeTrpcClient(workspaceId);

		void trpc.runtime.checkRoadmapMtime
			.query()
			.then((mtimeResult) => {
				const currentMtime = mtimeResult.roadmapFileMtime;

				// Skip full read if mtime hasn't changed (and we've loaded at least once)
				if (
					lastRoadmapFileMtimeRef.current !== null &&
					currentMtime !== null &&
					currentMtime === lastRoadmapFileMtimeRef.current
				) {
					return;
				}

				void trpc.runtime.readRoadmapFile
					.query()
					.then((r) => {
						lastRoadmapFileMtimeRef.current = r.mtime;
						if (r.exists && r.content) {
							setMarkdown((prev) => (prev !== r.content ? r.content : prev));
							if (r.content !== lastParsedContentRef.current) {
								lastParsedContentRef.current = r.content;
								void trpc.runtime.importRoadmapText
									.mutate({ content: r.content })
									.then((result) => {
										setParsedItems(result.items as RoadmapItem[]);
									})
									.catch(() => {});
							}
						}
					})
					.catch(() => {});
			})
			.catch(() => {
				// Fallback: if mtime check fails, do a full read (backwards compatible)
				void trpc.runtime.readRoadmapFile
					.query()
					.then((r) => {
						lastRoadmapFileMtimeRef.current = r.mtime;
						if (r.exists && r.content) {
							setMarkdown((prev) => (prev !== r.content ? r.content : prev));
							if (r.content !== lastParsedContentRef.current) {
								lastParsedContentRef.current = r.content;
								void trpc.runtime.importRoadmapText
									.mutate({ content: r.content })
									.then((result) => {
										setParsedItems(result.items as RoadmapItem[]);
									})
									.catch(() => {});
							}
						}
					})
					.catch(() => {});
			});
	}, [workspaceId]);

	useEffect(() => {
		loadFile();
		const interval = setInterval(loadFile, 3000);
		return () => clearInterval(interval);
	}, [loadFile]);

	return { markdown, setMarkdown, parsedItems, loadFile };
}
