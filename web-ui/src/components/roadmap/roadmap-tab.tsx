import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownCodeBlock } from "@/components/ui/markdown-code-block";
import { openFileOnHost } from "@/runtime/runtime-config-query";
import type { RoadmapItem } from "@/types";
import { withHighlights } from "./comment-overlay";
import { RoadmapEmptyState } from "./roadmap-empty-state";

interface RoadmapTabProps {
	highlightedMarkdown: string;
	rawMarkdown: string;
	parsedItems: RoadmapItem[];
	workspaceId: string | null;
	onMouseUp: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
	markdownRef: React.RefObject<HTMLDivElement>;
	handleClickMark: (id: string) => void;
	activeId: string | null;
	onSelectItem: (id: string) => void;
	onTemplateApplied?: () => void;
}

export function RoadmapTab({
	highlightedMarkdown,
	rawMarkdown,
	parsedItems,
	workspaceId,
	onMouseUp,
	onContextMenu,
	markdownRef,
	handleClickMark,
	activeId,
	onSelectItem,
	onTemplateApplied,
}: RoadmapTabProps): ReactElement {
	return (
		<div className="flex-1 min-w-0 overflow-y-auto bg-surface-0" style={{ padding: "24px 0" }}>
			<div className="px-8">
				<div className="mb-6 border-b border-border pb-3 flex items-baseline gap-2">
					<h1 className="text-xl font-bold text-text-primary">Roadmap</h1>
					<button
						type="button"
						className="inline-flex cursor-pointer items-center gap-1 text-xs text-text-tertiary hover:text-accent"
						onClick={() => void openFileOnHost(workspaceId, ".kanban/ROADMAP.md")}
					>
						(.kanban/ROADMAP.md) <ExternalLink size={10} />
					</button>
				</div>

				<div
					ref={markdownRef}
					className="relative [&::selection]:bg-accent/20 [&_*::selection]:bg-accent/20"
					onMouseUp={onMouseUp}
					onContextMenu={onContextMenu}
				>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={{
							h1: withHighlights(
								"h1",
								"text-2xl font-bold text-text-primary mt-6 mb-3 first:mt-0",
								activeId,
								handleClickMark,
							) as never,
							h2: (({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
								const text = typeof children === "string" ? children : String(children ?? "");
								const matchedItem = parsedItems.find((item) => item.title === text);
								return (
									<h2
										{...props}
										className="text-lg font-semibold text-text-primary mt-5 mb-2 border-b border-border pb-1 cursor-pointer hover:text-accent"
										onClick={() => {
											if (matchedItem) onSelectItem(matchedItem.id);
										}}
									>
										{children}
									</h2>
								);
							}) as never,
							h3: withHighlights(
								"h3",
								"text-base font-semibold text-text-primary mt-4 mb-1.5",
								activeId,
								handleClickMark,
							) as never,
							p: withHighlights(
								"p",
								"text-sm leading-relaxed text-text-secondary mb-3",
								activeId,
								handleClickMark,
							) as never,
							li: withHighlights("li", "leading-relaxed", activeId, handleClickMark) as never,
							ul: ({ children }) => (
								<ul className="list-disc pl-6 mb-3 text-sm text-text-secondary space-y-1">{children}</ul>
							),
							ol: ({ children }) => (
								<ol className="list-decimal pl-6 mb-3 text-sm text-text-secondary space-y-1">{children}</ol>
							),
							strong: withHighlights(
								"strong",
								"font-semibold text-text-primary",
								activeId,
								handleClickMark,
							) as never,
							em: ({ children }) => <em className="italic">{children}</em>,
							code: MarkdownCodeBlock as never,
							blockquote: ({ children }) => (
								<blockquote className="border-l-2 border-accent pl-3 mb-3 text-sm italic text-text-tertiary">
									{children}
								</blockquote>
							),
							hr: () => <hr className="border-border my-4" />,
							a: ({ href, children }) => (
								<a
									href={href}
									className="text-accent hover:text-accent-hover underline"
									target="_blank"
									rel="noreferrer"
								>
									{children}
								</a>
							),
							table: ({ children }) => <table className="w-full border-collapse mb-3 text-sm">{children}</table>,
							th: ({ children }) => (
								<th className="border border-border bg-surface-2 px-3 py-1.5 text-left text-xs font-medium text-text-primary">
									{children}
								</th>
							),
							td: withHighlights(
								"td",
								"border border-border px-3 py-1.5 text-text-secondary",
								activeId,
								handleClickMark,
							) as never,
						}}
					>
						{highlightedMarkdown}
					</ReactMarkdown>
				</div>
				{!rawMarkdown.trim() ? (
					<RoadmapEmptyState workspaceId={workspaceId} onTemplateApplied={onTemplateApplied} />
				) : null}
			</div>
		</div>
	);
}
