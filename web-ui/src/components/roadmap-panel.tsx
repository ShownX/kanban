import { createTasksFromRoadmapItem, promoteAgentTasksToRoadmapItem } from "@runtime-task-state";
import { ArrowLeft, ExternalLink, FileUp, Save, X } from "lucide-react";
import { createElement, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RoadmapCreateTaskDialog } from "@/components/roadmap-create-task-dialog";
import { RoadmapSpecView } from "@/components/roadmap-spec-view";
import { RoadmapTasksSummary } from "@/components/roadmap-tasks-summary";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ResizeHandle } from "@/resize/resize-handle";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { openFileOnHost } from "@/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { BoardData, RoadmapItem } from "@/types";

function createId(): string {
	return crypto.randomUUID();
}
function now(): number {
	return Date.now();
}

const HIGHLIGHT_COLORS = [
	"rgba(255, 209, 102, 0.35)",
	"rgba(120, 190, 255, 0.30)",
	"rgba(163, 113, 247, 0.30)",
	"rgba(63, 185, 80, 0.30)",
	"rgba(248, 81, 73, 0.25)",
];

interface Annotation {
	id: string;
	selectedText: string;
	comment: string;
	createdAt: number;
	color: string;
	resolved?: boolean;
}

// ---------------------------------------------------------------------------
// Highlight engine: injects markers into markdown text, rendered via React
// ---------------------------------------------------------------------------

const MARK_OPEN = "\u00AB"; // «
const MARK_CLOSE = "\u00BB"; // »
const MARK_SEP = "\u2016"; // ‖

/** Inject highlight markers into raw markdown for each annotation. */
function injectHighlightMarkers(md: string, annotations: Annotation[]): string {
	let result = md;
	for (const ann of annotations) {
		const idx = result.indexOf(ann.selectedText);
		if (idx === -1) continue;
		const marker = `${MARK_OPEN}${ann.id}${MARK_SEP}${ann.color}${MARK_SEP}${ann.selectedText}${MARK_CLOSE}`;
		result = result.slice(0, idx) + marker + result.slice(idx + ann.selectedText.length);
	}
	return result;
}

/** Parse a text string that may contain highlight markers into React nodes. */
function renderTextWithHighlights(
	text: string,
	activeId: string | null,
	onClickMark: (id: string) => void,
): Array<string | ReactElement> {
	const parts: Array<string | ReactElement> = [];
	let remaining = text;
	let key = 0;

	while (remaining.length > 0) {
		const openIdx = remaining.indexOf(MARK_OPEN);
		if (openIdx === -1) {
			parts.push(remaining);
			break;
		}
		if (openIdx > 0) {
			parts.push(remaining.slice(0, openIdx));
		}
		const closeIdx = remaining.indexOf(MARK_CLOSE, openIdx);
		if (closeIdx === -1) {
			parts.push(remaining.slice(openIdx));
			break;
		}
		const inner = remaining.slice(openIdx + 1, closeIdx);
		const sepFirst = inner.indexOf(MARK_SEP);
		const sepSecond = inner.indexOf(MARK_SEP, sepFirst + 1);
		if (sepFirst !== -1 && sepSecond !== -1) {
			const id = inner.slice(0, sepFirst);
			const color = inner.slice(sepFirst + 1, sepSecond);
			const highlightedText = inner.slice(sepSecond + 1);
			parts.push(
				<mark
					key={key++}
					data-ann-id={id}
					style={{
						backgroundColor: color,
						borderRadius: 2,
						padding: "1px 2px",
						cursor: "pointer",
						outline: activeId === id ? "2px solid var(--color-accent)" : undefined,
						outlineOffset: 1,
					}}
					onClick={() => onClickMark(id)}
				>
					{highlightedText}
				</mark>,
			);
		} else {
			parts.push(remaining.slice(openIdx, closeIdx + 1));
		}
		remaining = remaining.slice(closeIdx + 1);
	}
	return parts;
}

/** HOC that wraps a markdown component to parse highlight markers in its text children. */
function withHighlights(
	Tag: keyof JSX.IntrinsicElements,
	className: string,
	activeId: string | null,
	onClickMark: (id: string) => void,
) {
	return function HighlightedComponent({ children }: { children?: React.ReactNode }) {
		const processed = processChildren(children, activeId, onClickMark);
		return createElement(Tag, { className }, processed);
	};
}

function processChildren(
	children: React.ReactNode,
	activeId: string | null,
	onClickMark: (id: string) => void,
): React.ReactNode {
	if (typeof children === "string") {
		const parts = renderTextWithHighlights(children, activeId, onClickMark);
		return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
	}
	if (Array.isArray(children)) {
		return children.map((child, i) => {
			if (typeof child === "string") {
				const parts = renderTextWithHighlights(child, activeId, onClickMark);
				return parts.length === 1 && typeof parts[0] === "string" ? (
					<span key={i}>{parts[0]}</span>
				) : (
					<span key={i}>{parts}</span>
				);
			}
			return child;
		});
	}
	return children;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

interface RoadmapViewProps {
	board: BoardData;
	onBoardChange: (board: BoardData) => void;
	onClose: () => void;
	workspaceId: string | null;
	onRequestUpdate?: (prompt: string) => void;
}

export function RoadmapView({
	board,
	onBoardChange,
	onClose,
	workspaceId,
	onRequestUpdate,
}: RoadmapViewProps): ReactElement {
	const [markdown, setMarkdown] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
	const [annotations, setAnnotations] = useState<Annotation[]>(() => (board.roadmapAnnotations ?? []) as Annotation[]);
	const [pendingText, setPendingText] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	const [popover, setPopover] = useState<{ x: number; y: number; text: string } | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);

	const markdownRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const nextColorIdx = useRef(0);

	const [commentsPanelWidth, setCommentsPanelWidth] = useState(280);
	const { startDrag } = useResizeDrag();
	const handleResize = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const right =
				(e.currentTarget.closest("[data-roadmap-body]") as HTMLElement | null)?.getBoundingClientRect().right ??
				window.innerWidth;
			startDrag(e, {
				axis: "x",
				cursor: "ew-resize",
				onMove: (pointer) => setCommentsPanelWidth(Math.max(200, Math.min(500, right - pointer))),
			});
		},
		[startDrag],
	);

	// Load from file + poll every 3s for changes
	const [parsedItems, setParsedItems] = useState<RoadmapItem[]>([]);
	const loadFile = useCallback(() => {
		if (!workspaceId) return;
		const trpc = getRuntimeTrpcClient(workspaceId);
		void trpc.runtime.readRoadmapFile
			.query()
			.then((r) => {
				if (r.exists && r.content) {
					setMarkdown((prev) => (prev !== r.content ? r.content : prev));
					void trpc.runtime.importRoadmapText
						.mutate({ content: r.content })
						.then((result) => {
							setParsedItems(result.items as RoadmapItem[]);
						})
						.catch(() => {});
				}
			})
			.catch(() => {});
	}, [workspaceId]);

	useEffect(() => {
		loadFile();
		const interval = setInterval(loadFile, 3000);
		return () => clearInterval(interval);
	}, [loadFile]);

	// Create-tasks dialog state + handler.
	const [createTaskForItemId, setCreateTaskForItemId] = useState<string | null>(null);
	const resolveDefaultBaseRef = useCallback((): string => {
		for (const column of board.columns) {
			for (const card of column.cards) {
				if (card.baseRef) return card.baseRef;
			}
		}
		return "main";
	}, [board]);
	const handleCreateTasksForItem = useCallback(
		async (itemId: string, draft: { title: string; prompt: string }) => {
			if (!workspaceId) return;
			const roadmapItems = (board.roadmap ?? []) as RoadmapItem[];
			const item = roadmapItems.find((candidate) => candidate.id === itemId);
			if (!item) return;
			const result = createTasksFromRoadmapItem(
				board,
				item,
				[{ title: draft.title || undefined, prompt: draft.prompt, baseRef: resolveDefaultBaseRef() }],
				() => crypto.randomUUID(),
			);
			const nextRoadmap = roadmapItems.map((candidate) =>
				candidate.id === itemId ? result.updatedRoadmapItem : candidate,
			);
			onBoardChange({ ...result.board, roadmap: nextRoadmap });
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				await trpc.runtime.writeRoadmapFile.mutate({ items: nextRoadmap });
			} catch {
				// Best-effort — the board write already persisted the task; ROADMAP.md will
				// be updated next time the user saves the markdown.
			}
		},
		[board, onBoardChange, resolveDefaultBaseRef, workspaceId],
	);

	// Load roadmap-state.json (gitignored live dashboard state).
	const [agentCreatedTaskIdsByItemId, setAgentCreatedTaskIdsByItemId] = useState<Record<string, string[]>>({});
	useEffect(() => {
		if (!workspaceId) return;
		let cancelled = false;
		const loadState = () => {
			const trpc = getRuntimeTrpcClient(workspaceId);
			void trpc.runtime.readRoadmapState
				.query()
				.then((state) => {
					if (cancelled) return;
					const next: Record<string, string[]> = {};
					for (const [itemId, itemState] of Object.entries(state.itemStates)) {
						next[itemId] = itemState.agentCreatedTaskIds;
					}
					setAgentCreatedTaskIdsByItemId(next);
				})
				.catch(() => {});
		};
		loadState();
		const interval = setInterval(loadState, 3000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [workspaceId]);

	const handlePromoteAgentTasks = useCallback(
		async (itemId: string, taskIds: string[]) => {
			if (!workspaceId || taskIds.length === 0) return;
			const roadmapItems = (board.roadmap ?? []) as RoadmapItem[];
			const item = roadmapItems.find((candidate) => candidate.id === itemId);
			if (!item) return;
			const result = promoteAgentTasksToRoadmapItem(item, board, taskIds);
			if (result.promotedTaskIds.length === 0) return;
			const nextRoadmap = roadmapItems.map((candidate) =>
				candidate.id === itemId ? result.updatedRoadmapItem : candidate,
			);
			onBoardChange({ ...board, roadmap: nextRoadmap });

			const trpc = getRuntimeTrpcClient(workspaceId);
			try {
				await trpc.runtime.writeRoadmapFile.mutate({ items: nextRoadmap });
			} catch {
				// Best-effort: markdown write may fail; state write below still helpful.
			}

			// Remove promoted task IDs from roadmap-state.json's agentCreatedTaskIds.
			try {
				const currentState = await trpc.runtime.readRoadmapState.query();
				const existingItemState = currentState.itemStates[itemId];
				const promoted = new Set(result.promotedTaskIds);
				const nextAgentCreatedTaskIds = (existingItemState?.agentCreatedTaskIds ?? []).filter(
					(taskId) => !promoted.has(taskId),
				);
				const nextItemStates = {
					...currentState.itemStates,
					[itemId]: {
						itemId,
						agentCreatedTaskIds: nextAgentCreatedTaskIds,
						agentComments: existingItemState?.agentComments ?? [],
						lastUpdatedAt: Date.now(),
					},
				};
				await trpc.runtime.writeRoadmapState.mutate({ itemStates: nextItemStates });
				setAgentCreatedTaskIdsByItemId((prev) => ({ ...prev, [itemId]: nextAgentCreatedTaskIds }));
			} catch {
				// Best-effort: the next poll will reconcile the UI from the file.
			}
		},
		[board, onBoardChange, workspaceId],
	);

	// Pre-process markdown with highlight markers (skip resolved)
	const activeAnnotations = useMemo(() => annotations.filter((a) => !a.resolved), [annotations]);
	const highlightedMarkdown = useMemo(
		() => (activeAnnotations.length > 0 ? injectHighlightMarkers(markdown, activeAnnotations) : markdown),
		[markdown, activeAnnotations],
	);

	// Mark annotations as resolved when their text is no longer in the markdown
	useEffect(() => {
		let changed = false;
		const updated = annotations.map((a) => {
			if (a.resolved) return a;
			if (!markdown.includes(a.selectedText)) {
				changed = true;
				return { ...a, resolved: true };
			}
			return a;
		});
		if (changed) setAnnotations(updated);
	}, [markdown]); // eslint-disable-line react-hooks/exhaustive-deps

	// Persist annotations to board data
	useEffect(() => {
		const current = board.roadmapAnnotations ?? [];
		if (JSON.stringify(current) !== JSON.stringify(annotations)) {
			onBoardChange({ ...board, roadmapAnnotations: annotations });
		}
	}, [annotations]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync on annotation changes

	const handleClickMark = useCallback(
		(id: string) => {
			setActiveId(id === activeId ? null : id);
		},
		[activeId],
	);

	const saveMarkdown = useCallback(
		async (content: string) => {
			if (!workspaceId) return;
			setIsSaving(true);
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				const result = await trpc.runtime.importRoadmapText.mutate({ content });
				const items = result.items as RoadmapItem[];
				await trpc.runtime.writeRoadmapFile.mutate({ items });
				onBoardChange({ ...board, roadmap: items });
			} catch {
			} finally {
				setIsSaving(false);
			}
		},
		[workspaceId, board, onBoardChange],
	);

	const handleRequestUpdate = useCallback(() => {
		if (!onRequestUpdate || annotations.length === 0) return;
		const commentLines = annotations.map((a) => `- On "${a.selectedText}": ${a.comment}`).join("\n");
		const prompt = `Please update the .kanban/ROADMAP.md file based on these review comments:\n\n${commentLines}\n\nRead the current .kanban/ROADMAP.md, apply the feedback, and write the updated version.`;
		onRequestUpdate(prompt);
	}, [annotations, onRequestUpdate]);

	// Text selection
	const handleMouseUp = useCallback(() => {
		if (pendingText) return;
		const sel = window.getSelection();
		const text = sel?.toString().trim();
		if (!text || text.length < 2) {
			setPopover(null);
			return;
		}
		const range = sel?.getRangeAt(0);
		if (!range) return;
		const rect = range.getBoundingClientRect();
		setPopover({ x: rect.left + rect.width / 2 - 50, y: rect.top, text });
	}, [pendingText]);

	// Dismiss popover on click outside
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest("[data-popover]")) return;
			setPopover(null);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	const startComment = useCallback(() => {
		if (!popover) return;
		setPendingText(popover.text);
		setCommentDraft("");
		setPopover(null);
	}, [popover]);

	const submitComment = useCallback(() => {
		const text = commentDraft.trim();
		if (!text || !pendingText) return;
		const color = HIGHLIGHT_COLORS[nextColorIdx.current % HIGHLIGHT_COLORS.length]!;
		nextColorIdx.current += 1;
		const ann: Annotation = { id: createId(), selectedText: pendingText, comment: text, createdAt: now(), color };
		setAnnotations((prev) => [...prev, ann]);
		setActiveId(ann.id);
		setPendingText(null);
		setCommentDraft("");
	}, [commentDraft, pendingText]);

	const deleteAnnotation = useCallback(
		(id: string) => {
			setAnnotations((prev) => prev.filter((a) => a.id !== id));
			if (activeId === id) setActiveId(null);
		},
		[activeId],
	);

	const handleImportFile = useCallback(
		async (file: File) => {
			const text = await file.text();
			if (text.trim()) {
				setMarkdown(text);
				void saveMarkdown(text);
			}
		},
		[saveMarkdown],
	);

	const sortedAnnotations = useMemo(() => [...annotations].sort((a, b) => a.createdAt - b.createdAt), [annotations]);

	const selectedItem = selectedItemId ? (parsedItems.find((item) => item.id === selectedItemId) ?? null) : null;

	if (selectedItem) {
		return <RoadmapSpecView item={selectedItem} onBack={() => setSelectedItemId(null)} />;
	}

	return (
		<div className="flex flex-1 flex-col min-h-0 min-w-0">
			<RoadmapCreateTaskDialog
				open={createTaskForItemId !== null}
				roadmapItemTitle={
					((board.roadmap ?? []) as RoadmapItem[]).find((item) => item.id === createTaskForItemId)?.title ?? ""
				}
				onCancel={() => setCreateTaskForItemId(null)}
				onConfirm={(draft) => {
					const itemId = createTaskForItemId;
					setCreateTaskForItemId(null);
					if (itemId) {
						void handleCreateTasksForItem(itemId, draft);
					}
				}}
			/>
			{/* Header */}
			<div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-3">
				<Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onClose} />
				<span className="text-sm font-medium text-text-primary">Roadmap</span>
				<div className="flex-1" />
				{isSaving && (
					<span className="text-[11px] text-text-tertiary flex items-center gap-1">
						<Save size={10} /> Saving…
					</span>
				)}
				<Button
					size="sm"
					variant="default"
					icon={<FileUp size={14} />}
					onClick={() => fileInputRef.current?.click()}
				>
					Import
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".md,.txt,.markdown"
					className="hidden"
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) void handleImportFile(f);
						e.target.value = "";
					}}
				/>
				<Button size="sm" variant="primary" disabled={annotations.length === 0} onClick={handleRequestUpdate}>
					Update
				</Button>
				{onRequestUpdate ? (
					<Button
						size="sm"
						onClick={() => {
							onRequestUpdate(
								`Before generating tasks, do the following:

1. Run \`kanban task list\` to see all existing tasks and their statuses. Do NOT create tasks that already exist or duplicate existing work.

2. Read .kanban/ROADMAP.md to understand the roadmap items and their requirements.

3. For each roadmap item with status "Planned" or "In Progress" that needs more tasks:
   - Analyze the current project state (check what code/files already exist) to understand what's already done.
   - Create only the tasks that are still needed.
   - Make each task small enough for one agent session.
   - Use: kanban task create --prompt "..." --title "..."

4. After creating tasks, wire dependencies so they execute in the right order:
   - Use: kanban task link --task-id <waiting-task> --linked-task-id <prerequisite-task>
   - The waiting task stays in backlog until the prerequisite moves to done.
   - Tasks with no dependencies can run in parallel.

5. Update the ### Tasks section in .kanban/ROADMAP.md with the created task IDs.

Key rules:
- Skip roadmap items that already have all their tasks created.
- Never create duplicate tasks.
- Order matters: foundational work (data models, configs) before features that depend on them.`,
							);
						}}
					>
						⚡ Generate tasks
					</Button>
				) : null}
			</div>

			{/* Body */}
			<div className="flex flex-1 min-h-0" data-roadmap-body>
				{/* Document */}
				<div className="flex-1 min-w-0 overflow-y-auto bg-surface-0" style={{ padding: "24px 0" }}>
					<div className="mx-auto px-8" style={{ maxWidth: 960 }}>
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

						<div ref={markdownRef} className="relative" onMouseUp={handleMouseUp}>
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
													if (matchedItem) setSelectedItemId(matchedItem.id);
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
										<ol className="list-decimal pl-6 mb-3 text-sm text-text-secondary space-y-1">
											{children}
										</ol>
									),
									strong: withHighlights(
										"strong",
										"font-semibold text-text-primary",
										activeId,
										handleClickMark,
									) as never,
									em: ({ children }) => <em className="italic">{children}</em>,
									code: ({ children, className }) => {
										if (className?.startsWith("language-"))
											return (
												<code className="block rounded-md bg-surface-2 px-4 py-3 text-xs font-mono text-text-primary overflow-x-auto mb-3">
													{children}
												</code>
											);
										return (
											<code className="rounded-sm bg-surface-2 px-1 py-0.5 text-xs font-mono text-text-primary">
												{children}
											</code>
										);
									},
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
									table: ({ children }) => (
										<table className="w-full border-collapse mb-3 text-sm">{children}</table>
									),
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
						{!markdown.trim() ? (
							<div className="flex flex-col items-center justify-center py-20 text-center">
								<p className="text-text-secondary text-sm max-w-sm">
									Your roadmap is empty. Use the <strong>Kanban agent</strong> in the left sidebar to generate
									a roadmap from your project description.
								</p>
							</div>
						) : null}
					</div>
				</div>

				{/* Resize handle */}
				<ResizeHandle orientation="vertical" ariaLabel="Resize comments panel" onMouseDown={handleResize} />

				{/* Comments sidebar */}
				<div
					className="shrink-0 bg-surface-1 overflow-y-auto flex flex-col"
					style={{ width: commentsPanelWidth }}
					data-comment-sidebar
				>
					<div className="flex items-center gap-2 px-3 py-2 border-b border-border">
						<span className="text-xs font-medium text-text-tertiary uppercase">Review Comments</span>
						<span className="text-[11px] text-text-tertiary">({annotations.length})</span>
					</div>

					{/* Pending comment */}
					{pendingText && (
						<div className="mx-2 mt-2 flex flex-col gap-1.5 rounded-md border border-accent bg-accent/5 p-2">
							<textarea
								className="min-h-[40px] rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary outline-none focus:border-border-focus resize-none"
								value={commentDraft}
								onChange={(e) => setCommentDraft(e.target.value)}
								placeholder="Add your comment…"
								onKeyDown={(e) => {
									if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
										e.preventDefault();
										submitComment();
									}
									if (e.key === "Escape") setPendingText(null);
								}}
							/>
							<div className="flex items-center justify-between">
								<span className="text-[10px] text-text-tertiary">⌘+Enter to send</span>
								<div className="flex gap-1">
									<Button size="sm" variant="primary" onClick={submitComment}>
										Add
									</Button>
									<Button size="sm" variant="default" onClick={() => setPendingText(null)}>
										Cancel
									</Button>
								</div>
							</div>
						</div>
					)}

					{/* Comment cards positioned by Y */}
					<div className="relative flex-1">
						{sortedAnnotations.map((ann) => {
							return (
								<div
									key={ann.id}
									className={cn(
										"group mx-2 my-1.5 rounded-md border px-2.5 py-2 transition-colors",
										ann.resolved
											? "border-border bg-surface-2 opacity-50"
											: activeId === ann.id
												? "border-accent bg-accent/5"
												: "border-border bg-surface-2 hover:border-border-bright",
									)}
									style={{
										borderLeftWidth: 3,
										borderLeftColor: ann.resolved ? "var(--color-border)" : ann.color,
									}}
									onClick={() => {
										if (ann.resolved) return;
										setActiveId(ann.id === activeId ? null : ann.id);
										const mark = markdownRef.current?.querySelector(`mark[data-ann-id="${ann.id}"]`);
										mark?.scrollIntoView({ behavior: "smooth", block: "center" });
									}}
								>
									<div className="flex items-start justify-between">
										<span className="text-[10px] text-text-tertiary">
											{ann.resolved && <span className="text-status-green mr-1">✓ Resolved</span>}
											{new Date(ann.createdAt).toLocaleString()}
										</span>
										<button
											type="button"
											className="hidden cursor-pointer rounded p-0.5 text-text-tertiary hover:text-status-red group-hover:block"
											onClick={(e) => {
												e.stopPropagation();
												deleteAnnotation(ann.id);
											}}
										>
											<X size={10} />
										</button>
									</div>
									<p
										className={cn(
											"mt-1 whitespace-pre-wrap text-xs",
											ann.resolved ? "line-through text-text-tertiary" : "text-text-primary",
										)}
									>
										{ann.comment}
									</p>
								</div>
							);
						})}
						{annotations.length === 0 && !pendingText && (
							<p className="px-3 py-6 text-center text-[11px] text-text-tertiary">
								Select text in the document and click "Comment" to start reviewing.
							</p>
						)}
					</div>
				</div>
			</div>

			{/* Selection popover */}
			{popover && (
				<div
					data-popover
					className="fixed z-50 rounded-md border border-border bg-surface-1 shadow-lg"
					style={{ left: popover.x, top: popover.y - 36 }}
				>
					<button
						type="button"
						className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-text-primary hover:bg-surface-3"
						onMouseDown={(e) => {
							e.preventDefault();
							startComment();
						}}
					>
						💬 Comment
					</button>
				</div>
			)}
		</div>
	);
}
