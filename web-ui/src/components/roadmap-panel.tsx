import { createTasksFromRoadmapItem, promoteAgentTasksToRoadmapItem } from "@runtime-task-state";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { createElement, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RoadmapCreateTaskDialog } from "@/components/roadmap-create-task-dialog";
import { Button } from "@/components/ui/button";
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
	const [_isSaving, setIsSaving] = useState(false);
	const [selectedItemId, setSelectedItemId] = useState<string | null>("__overall__");
	const [activeTab, setActiveTab] = useState<"roadmap" | "requirements" | "design" | "tasks">("requirements");
	const [annotations, setAnnotations] = useState<Annotation[]>(() => (board.roadmapAnnotations ?? []) as Annotation[]);

	// Persist annotations to board state whenever they change
	const boardRef = useRef(board);
	boardRef.current = board;
	const onBoardChangeRef = useRef(onBoardChange);
	onBoardChangeRef.current = onBoardChange;
	const prevAnnotationsRef = useRef(annotations);
	useEffect(() => {
		if (prevAnnotationsRef.current !== annotations) {
			prevAnnotationsRef.current = annotations;
			onBoardChangeRef.current({ ...boardRef.current, roadmapAnnotations: annotations });
		}
	}, [annotations]);
	const [pendingText, setPendingText] = useState<string | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [commentDraft, setCommentDraft] = useState("");
	const [popover, setPopover] = useState<{ x: number; y: number; text: string } | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);

	const markdownRef = useRef<HTMLDivElement>(null);
	const _fileInputRef = useRef<HTMLInputElement>(null);
	const nextColorIdx = useRef(0);

	const [_commentsPanelWidth, setCommentsPanelWidth] = useState(280);
	const { startDrag } = useResizeDrag();
	const _handleResize = useCallback(
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
	const [_agentCreatedTaskIdsByItemId, setAgentCreatedTaskIdsByItemId] = useState<Record<string, string[]>>({});
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

	const _handlePromoteAgentTasks = useCallback(
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
			const ann = annotations.find((a) => a.id === id);
			if (ann) {
				setActiveId(id);
				// Position popup above the mark element
				const mark = markdownRef.current?.querySelector(`mark[data-ann-id="${id}"]`);
				if (mark) {
					const rect = mark.getBoundingClientRect();
					setPopover({ x: rect.left, y: rect.top, text: ann.selectedText });
				}
			}
		},
		[annotations],
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

	const _handleRequestUpdate = useCallback(() => {
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
			return;
		}
		const range = sel?.getRangeAt(0);
		if (!range) return;
		const rect = range.getBoundingClientRect();
		setPopover({ x: rect.left + rect.width / 2 - 50, y: rect.top, text });
	}, [pendingText]);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent) => {
			if (pendingText) return;
			e.preventDefault();
			const sel = window.getSelection();
			const selectedText = sel?.toString().trim();
			if (selectedText && selectedText.length >= 2) {
				setPopover({ x: e.clientX, y: e.clientY, text: selectedText });
				return;
			}
			// No selection — use nearest block text as context
			const target = e.target as HTMLElement;
			const block = target.closest("p, h1, h2, h3, h4, li, td, th, blockquote");
			const contextText = block?.textContent?.trim().slice(0, 80) || "general";
			setPopover({ x: e.clientX, y: e.clientY, text: contextText });
		},
		[pendingText],
	);

	// Dismiss popover on Escape key
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setPopover(null);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
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
		// If editing an existing annotation, update it
		const existing = activeId ? annotations.find((a) => a.id === activeId) : null;
		if (existing) {
			setAnnotations((prev) => prev.map((a) => (a.id === activeId ? { ...a, comment: text } : a)));
		} else {
			const color = HIGHLIGHT_COLORS[nextColorIdx.current % HIGHLIGHT_COLORS.length]!;
			nextColorIdx.current += 1;
			const ann: Annotation = { id: createId(), selectedText: pendingText, comment: text, createdAt: now(), color };
			setAnnotations((prev) => [...prev, ann]);
			setActiveId(ann.id);
		}
		setPendingText(null);
		setCommentDraft("");
	}, [activeId, annotations, commentDraft, pendingText]);

	const deleteAnnotation = useCallback(
		(id: string) => {
			setAnnotations((prev) => prev.filter((a) => a.id !== id));
			if (activeId === id) setActiveId(null);
		},
		[activeId],
	);

	const _handleImportFile = useCallback(
		async (file: File) => {
			const text = await file.text();
			if (text.trim()) {
				setMarkdown(text);
				void saveMarkdown(text);
			}
		},
		[saveMarkdown],
	);

	const _sortedAnnotations = useMemo(() => [...annotations].sort((a, b) => a.createdAt - b.createdAt), [annotations]);

	const specItems = parsedItems.filter((item) => item.id.startsWith("roadmap_"));
	const selectedItem = selectedItemId
		? selectedItemId === "__overall__"
			? ({
					id: "__overall__",
					title: "Overall",
					description: "",
					status: "planned" as const,
					requirements:
						specItems
							.map((item) => item.requirements)
							.filter(Boolean)
							.join("\n\n") || undefined,
					design:
						specItems
							.map((item) => item.design)
							.filter(Boolean)
							.join("\n\n") || undefined,
					openQuestions: specItems.flatMap((item) => item.openQuestions),
					tasks: specItems.flatMap((item) => item.tasks),
					linkedTaskIds: specItems.flatMap((item) => item.linkedTaskIds),
					comments: [],
					createdAt: 0,
					updatedAt: 0,
				} satisfies RoadmapItem)
			: (parsedItems.find((item) => item.id === selectedItemId) ?? null)
		: null;
	const effectiveTab = activeTab;

	return (
		<div className={`flex flex-1 flex-col min-h-0 min-w-0 relative ${isGenerating ? "generating-border" : ""}`}>
			{isGenerating && (
				<style>{`
					@keyframes border-spin {
						0% { border-color: var(--color-accent); }
						25% { border-color: var(--color-status-green); }
						50% { border-color: var(--color-status-yellow); }
						75% { border-color: var(--color-accent-2, var(--color-accent)); }
						100% { border-color: var(--color-accent); }
					}
					.generating-border {
						border: 2px solid var(--color-accent);
						border-radius: 4px;
						animation: border-spin 2s linear infinite;
					}
				`}</style>
			)}
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
			<div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-surface-1 px-3 overflow-x-auto">
				<Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onClose} />
				{(["roadmap", "requirements", "design", "tasks"] as const).map((tab) => (
					<button
						key={tab}
						type="button"
						onClick={() => setActiveTab(tab)}
						className={`shrink-0 px-2 py-1 text-xs font-medium rounded capitalize ${activeTab === tab ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
					>
						{tab}
					</button>
				))}
				<div className="flex-1" />
				{onRequestUpdate ? (
					<Button
						size="sm"
						onClick={() => {
							const specSlug = selectedItem?.title
								? selectedItem.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")
								: "overall";
							let prompt: string;
							if (activeTab === "requirements") {
								prompt = `Read .kanban/ROADMAP.md and write/update requirements for ${selectedItem?.title ?? "the project"} at .kanban/specs/${specSlug}/requirements.md using EARS notation.`;
							} else if (activeTab === "design") {
								prompt = `Read .kanban/ROADMAP.md and the requirements, then write/update the technical design for ${selectedItem?.title ?? "the project"} at .kanban/specs/${specSlug}/design.md.`;
							} else if (activeTab === "tasks") {
								prompt = `Before generating tasks:\n1. Run \`kanban task list\` to see existing tasks. Do NOT create duplicates.\n2. Read .kanban/ROADMAP.md and the spec at .kanban/specs/${specSlug}/.\n3. Create only tasks that are still needed. Use: kanban task create --prompt "..." --title "..."\n4. Wire dependencies: kanban task link --task-id <waiting> --linked-task-id <prerequisite>\n5. Update .kanban/specs/${specSlug}/tasks.md with the task list.`;
							} else {
								prompt =
									"Read .kanban/ROADMAP.md and the human's latest comments. Update the roadmap based on the comments: revise items, adjust statuses, add new items, or answer questions. Preserve the table structure and all existing columns.";
							}
							onRequestUpdate(prompt);
							setIsGenerating(true);
							setTimeout(() => setIsGenerating(false), 30000);
						}}
					>
						⚡ Generate
					</Button>
				) : null}
				{specItems.length > 0 ? (
					<select
						value={selectedItemId ?? "__overall__"}
						onChange={(e) => {
							const id = e.target.value;
							setSelectedItemId(id || "__overall__");
							if (activeTab === "roadmap") setActiveTab("requirements");
						}}
						className="h-7 shrink-0 rounded border border-border bg-surface-2 px-2 text-xs text-text-primary outline-none max-w-[150px] truncate"
					>
						<option value="__overall__">Overall</option>
						{specItems.map((item) => (
							<option key={item.id} value={item.id}>
								{item.title}
							</option>
						))}
					</select>
				) : null}
			</div>
			{/* Body */}
			<div className="flex flex-1 min-h-0" data-roadmap-body>
				{effectiveTab === "roadmap" ? (
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
								onMouseUp={handleMouseUp}
								onContextMenu={handleContextMenu}
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
											<ul className="list-disc pl-6 mb-3 text-sm text-text-secondary space-y-1">
												{children}
											</ul>
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
										Your roadmap is empty. Use the <strong>Kanban agent</strong> in the left sidebar to
										generate a roadmap from your project description.
									</p>
								</div>
							) : null}
						</div>
					</div>
				) : (
					<div className="flex-1 min-w-0 overflow-y-auto bg-surface-0 p-6">
						<div className="px-8">
							{selectedItem ? (
								<SpecTabContent
									item={selectedItem}
									tab={effectiveTab as "requirements" | "design" | "tasks"}
									workspaceId={workspaceId}
								/>
							) : (
								<p className="text-text-tertiary text-sm text-center py-16">
									Select a spec from the dropdown above.
								</p>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Selection popover */}
			{popover && !pendingText && (
				<div
					data-popover
					className="fixed z-50 rounded-md border border-border bg-surface-1 shadow-lg"
					style={{ left: popover.x, top: popover.y - 36 }}
					onMouseDown={(e) => e.preventDefault()}
				>
					<button
						type="button"
						className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-text-primary hover:bg-surface-3"
						onMouseDown={(e) => {
							e.preventDefault();
							setPendingText(popover.text || "(general comment)");
							setCommentDraft("");
							setPopover(null);
						}}
					>
						💬 Comment
					</button>
				</div>
			)}

			{/* Unified comment card */}
			{(activeId || pendingText) &&
				(() => {
					const ann = activeId ? annotations.find((a) => a.id === activeId) : null;
					const anchorText = pendingText || ann?.selectedText || "";
					const mark = activeId ? markdownRef.current?.querySelector(`mark[data-ann-id="${activeId}"]`) : null;
					const rect = mark?.getBoundingClientRect();
					const top = rect ? rect.top - 8 : 150;
					const left = rect ? Math.min(rect.left, window.innerWidth - 320) : 100;
					// Find all comments for this anchor text
					const relatedComments = annotations.filter((a) => a.selectedText === anchorText);
					return (
						<div
							className="fixed z-50 w-80 rounded-lg border border-border bg-surface-1 shadow-xl"
							style={{ left, top, transform: "translateY(-100%)" }}
						>
							{/* Header */}
							<div className="px-3 pt-3 pb-1">
								<p className="text-[11px] text-text-tertiary m-0 truncate">
									&ldquo;{anchorText.slice(0, 60)}
									{anchorText.length > 60 ? "…" : ""}&rdquo;
								</p>
							</div>
							{/* Previous comments */}
							{relatedComments.length > 0 && (
								<div className="px-3 py-1 space-y-1.5 max-h-[150px] overflow-y-auto">
									{relatedComments.map((c) => (
										<div key={c.id} className="flex items-start gap-1.5 group">
											<span
												className="shrink-0 w-1.5 h-1.5 mt-1 rounded-full"
												style={{ background: c.color }}
											/>
											<p className="m-0 flex-1 text-xs text-text-primary">{c.comment}</p>
											<button
												type="button"
												onClick={() => deleteAnnotation(c.id)}
												className="shrink-0 opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-red"
											>
												<X size={10} />
											</button>
										</div>
									))}
								</div>
							)}
							{/* Input */}
							<div className="px-3 pb-3 pt-2 border-t border-border mt-1">
								<textarea
									rows={2}
									value={commentDraft}
									onChange={(e) => setCommentDraft(e.target.value)}
									placeholder="Add a comment…"
									className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-border-focus resize-none"
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
											e.preventDefault();
											submitComment();
										}
										if (e.key === "Escape") {
											setPendingText(null);
											setActiveId(null);
										}
									}}
								/>
								<div className="flex items-center justify-end mt-1.5 gap-1.5">
									<button
										type="button"
										onClick={() => {
											setPendingText(null);
											setActiveId(null);
										}}
										className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary rounded"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={submitComment}
										disabled={!commentDraft.trim()}
										className="px-2 py-1 text-xs font-medium text-white bg-accent rounded disabled:opacity-40"
									>
										Add
									</button>
								</div>
							</div>
						</div>
					);
				})()}
		</div>
	);
}

function SpecTabContent({
	item,
	tab,
	workspaceId,
}: {
	item: RoadmapItem;
	tab: "requirements" | "design" | "tasks";
	workspaceId: string | null;
}): ReactElement {
	const [fileContent, setFileContent] = useState<string | null>(null);
	const specSlug = item.id === "__overall__" ? "overall" : item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	const fileName = `${tab === "tasks" ? "tasks" : tab}.md`;

	useEffect(() => {
		if (!workspaceId) return;
		setFileContent(null);
		const trpc = getRuntimeTrpcClient(workspaceId);
		void trpc.runtime.readSpecFile
			.query({ specName: specSlug, fileName })
			.then((r) => {
				setFileContent(r.content);
			})
			.catch(() => {});
	}, [workspaceId, specSlug, fileName]);

	// Fallback to inline content from parsed roadmap item
	const inlineContent =
		tab === "requirements"
			? item.requirements
			: tab === "design"
				? item.design
				: item.tasks.length > 0
					? item.tasks
							.map(
								(ref) => `- [ ] \`${ref.taskId}\` ${ref.title}${ref.agentCreated ? " _(agent-created)_" : ""}`,
							)
							.join("\n")
					: null;

	const content = fileContent ?? inlineContent;

	if (!content) {
		const messages = {
			requirements: "No requirements yet. Use the sidebar agent to generate requirements for this item.",
			design: "No design yet. Use the sidebar agent to generate a design for this item.",
			tasks: "No tasks yet. Click ⚡ Generate tasks to decompose this item.",
		};
		return <p className="text-text-tertiary text-sm text-center py-16">{messages[tab]}</p>;
	}

	return (
		<div className="prose-sm">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
		</div>
	);
}
