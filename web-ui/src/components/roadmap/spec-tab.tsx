import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownCodeBlock } from "@/components/ui/markdown-code-block";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RoadmapItem } from "@/types";

interface SpecTabContentProps {
	item: RoadmapItem;
	tab: "requirements" | "design" | "tasks";
	workspaceId: string | null;
	onMouseUp?: () => void;
	onContextMenu?: (e: React.MouseEvent) => void;
	/** Navigate to a task card on the board. */
	onNavigateToTask?: (taskId: string) => void;
	/** When true, the spec tab polls for file changes (e.g., during generation). */
	isGenerating?: boolean;
}

/** Extract a task ID from a markdown list item's text content.
 *  Matches patterns like `taskId` at the start of the text. */
function extractTaskIdFromText(text: string): string | null {
	const match = text.match(/^\s*(?:\[[ x]\]\s*)?`([^`]+)`/);
	return match?.[1] ?? null;
}

/** Recursively collect text content from React children (string nodes and nested element children). */
function collectTextFromChildren(children: React.ReactNode): string {
	if (typeof children === "string") return children;
	if (typeof children === "number") return String(children);
	if (Array.isArray(children)) return children.map(collectTextFromChildren).join("");
	if (children && typeof children === "object" && "props" in children) {
		return collectTextFromChildren((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
	}
	return "";
}

export function SpecTabContent({
	item,
	tab,
	workspaceId,
	onMouseUp,
	onContextMenu,
	onNavigateToTask,
	isGenerating,
}: SpecTabContentProps): ReactElement {
	const [cache, setCache] = useState<Record<string, string | null>>({});
	const specSlug = item.id === "__overall__" ? "overall" : item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	const fileName = `${tab === "tasks" ? "tasks" : tab}.md`;
	const cacheKey = `${specSlug}/${fileName}`;

	const fetchContent = useCallback(() => {
		if (!workspaceId) return;
		const trpc = getRuntimeTrpcClient(workspaceId);
		void trpc.runtime.readSpecFile
			.query({ specName: specSlug, fileName })
			.then((r) => {
				setCache((prev) => {
					if (prev[cacheKey] === r.content) return prev;
					return { ...prev, [cacheKey]: r.content };
				});
			})
			.catch(() => {
				setCache((prev) => {
					if (prev[cacheKey] === null) return prev;
					return { ...prev, [cacheKey]: null };
				});
			});
	}, [workspaceId, specSlug, fileName, cacheKey]);

	// Initial load
	useEffect(() => {
		if (cache[cacheKey] !== undefined) return;
		fetchContent();
	}, [cacheKey, cache, fetchContent]);

	// Poll every 3s while generating, or every 10s otherwise, to pick up agent changes
	useEffect(() => {
		const interval = setInterval(fetchContent, isGenerating ? 3000 : 10000);
		return () => clearInterval(interval);
	}, [fetchContent, isGenerating]);
	// Fallback to inline task list from parsed roadmap item (requirements/design now load exclusively from spec files)
	const inlineContent =
		tab === "tasks" && item.tasks.length > 0
			? item.tasks
					.map((ref) => `- [ ] \`${ref.taskId}\` ${ref.title}${ref.agentCreated ? " _(agent-created)_" : ""}`)
					.join("\n")
			: null;

	const knownTaskIds = useMemo(() => new Set(item.tasks.map((ref) => ref.taskId)), [item.tasks]);

	const handleTaskRowClick = useCallback(
		(taskId: string) => {
			onNavigateToTask?.(taskId);
		},
		[onNavigateToTask],
	);

	const markdownComponents = useMemo(() => {
		const base: Record<string, unknown> = { code: MarkdownCodeBlock as never };
		if (tab !== "tasks" || !onNavigateToTask) return base;
		return {
			...base,
			li: (props: React.HTMLAttributes<HTMLLIElement> & { children?: React.ReactNode }) => {
				const text = collectTextFromChildren(props.children);
				const taskId = extractTaskIdFromText(text);
				if (taskId && knownTaskIds.has(taskId)) {
					return (
						<li
							{...props}
							className="cursor-pointer rounded-sm px-1 -mx-1 hover:bg-surface-3 transition-colors"
							onClick={() => handleTaskRowClick(taskId)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleTaskRowClick(taskId);
								}
							}}
						/>
					);
				}
				return <li {...props} />;
			},
		};
	}, [tab, onNavigateToTask, knownTaskIds, handleTaskRowClick]);

	const content = cache[cacheKey] ?? inlineContent;

	if (!content) {
		const messages = {
			requirements: "No requirements yet. Use the sidebar agent to generate requirements for this item.",
			design: "No design yet. Use the sidebar agent to generate a design for this item.",
			tasks: "No tasks yet. Click ⚡ Generate tasks to decompose this item.",
		};
		return <p className="text-text-tertiary text-sm text-center py-16">{messages[tab]}</p>;
	}

	return (
		<div
			className="[&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-text-secondary [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ul]:text-sm [&_ul]:text-text-secondary [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_ol]:text-sm [&_ol]:text-text-secondary [&_ol]:space-y-1 [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-text-primary [&_em]:italic [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:mb-3 [&_blockquote]:text-sm [&_blockquote]:italic [&_blockquote]:text-text-tertiary [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_table]:mb-3 [&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-text-primary [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:text-text-secondary [&_hr]:border-border [&_hr]:my-4"
			onMouseUp={onMouseUp}
			onContextMenu={onContextMenu}
		>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as never}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
