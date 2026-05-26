import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoadmapCreateTaskDialog } from "@/components/roadmap-create-task-dialog";
import { useResizeDrag } from "@/resize/use-resize-drag";
import type { BoardData, RoadmapItem } from "@/types";
import { CommentCard, SelectionPopover } from "./comment-overlay";
import { RoadmapHeader } from "./roadmap-header";
import { RoadmapTab } from "./roadmap-tab";
import { RoadmapTimeline } from "./roadmap-timeline";
import { SharedMemoryPanel } from "./shared-memory-panel";
import { SpecTabContent } from "./spec-tab";
import type { TabId } from "./types";
import { useRoadmapAnnotations } from "./use-roadmap-annotations";
import { useRoadmapAutoSync } from "./use-roadmap-auto-sync";
import { useRoadmapData } from "./use-roadmap-data";
import { useRoadmapTasks } from "./use-roadmap-tasks";

interface RoadmapViewProps {
	board: BoardData;
	onBoardChange: (board: BoardData) => void;
	onClose: () => void;
	workspaceId: string | null;
	onRequestUpdate?: (prompt: string) => void;
	/** When set, the roadmap view will navigate to this item and switch to the requirements tab. */
	navigateToItemId?: string | null;
	/** Called after the navigation triggered by `navigateToItemId` has been consumed, so the parent can clear the value. */
	onNavigateComplete?: () => void;
	/** Navigate to a task card on the board by its ID. */
	onNavigateToTask?: (taskId: string) => void;
}

export function RoadmapView({
	board,
	onBoardChange,
	onClose,
	workspaceId,
	onRequestUpdate,
	navigateToItemId,
	onNavigateComplete,
	onNavigateToTask,
}: RoadmapViewProps): ReactElement {
	const [selectedItemId, setSelectedItemId] = useState<string | null>("__overall__");
	const [activeTab, setActiveTab] = useState<TabId>("requirements");
	const [isGenerating, setIsGenerating] = useState(false);
	const [_isSaving, setIsSaving] = useState(false);

	const markdownRef = useRef<HTMLDivElement>(null);
	const _fileInputRef = useRef<HTMLInputElement>(null);

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

	const { markdown, setMarkdown, parsedItems, loadFile } = useRoadmapData(workspaceId);

	const annotationState = useRoadmapAnnotations({
		board,
		onBoardChange,
		markdown,
		markdownRef,
	});

	const {
		annotations,
		highlightedMarkdown,
		activeId,
		setActiveId,
		pendingText,
		setPendingText,
		commentDraft,
		setCommentDraft,
		popover,
		setPopover,
		handleClickMark,
		startComment,
		submitComment,
		deleteAnnotation,
		handleMouseUp,
		handleContextMenu,
	} = annotationState;

	const { createTaskForItemId, setCreateTaskForItemId, handleCreateTasksForItem } = useRoadmapTasks({
		board,
		onBoardChange,
		workspaceId,
	});

	useRoadmapAutoSync({ board, workspaceId, onBoardChange });

	// Navigate to a specific roadmap item when requested externally (e.g. from a card badge click).
	useEffect(() => {
		if (!navigateToItemId) return;
		setSelectedItemId(navigateToItemId);
		if (activeTab === "roadmap") setActiveTab("requirements");
		onNavigateComplete?.();
	}, [navigateToItemId]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally fire only when navigateToItemId changes

	const saveMarkdown = useCallback(
		async (content: string) => {
			if (!workspaceId) return;
			setIsSaving(true);
			try {
				const { getRuntimeTrpcClient } = await import("@/runtime/trpc-client");
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

	const _handleImportFile = useCallback(
		async (file: File) => {
			const text = await file.text();
			if (text.trim()) {
				setMarkdown(text);
				void saveMarkdown(text);
			}
		},
		[saveMarkdown, setMarkdown],
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
			<RoadmapHeader
				activeTab={activeTab}
				onTabChange={(tab) => {
					setActiveTab(tab);
				}}
				specItems={specItems}
				selectedItemId={selectedItemId}
				selectedItemTitle={selectedItem?.title}
				onSelectItem={(id) => {
					setSelectedItemId(id);
					if (activeTab === "roadmap") setActiveTab("requirements");
				}}
				onGenerate={onRequestUpdate}
				onClose={onClose}
				isGenerating={isGenerating}
				setIsGenerating={setIsGenerating}
				workspaceId={workspaceId}
				onTemplateApplied={loadFile}
			/>
			{/* Body */}
			<div className="flex flex-1 min-h-0" data-roadmap-body>
				{effectiveTab === "roadmap" ? (
					<RoadmapTab
						highlightedMarkdown={highlightedMarkdown}
						rawMarkdown={markdown}
						parsedItems={parsedItems}
						workspaceId={workspaceId}
						onMouseUp={handleMouseUp}
						onContextMenu={handleContextMenu}
						markdownRef={markdownRef}
						handleClickMark={handleClickMark}
						activeId={activeId}
						onSelectItem={(id) => setSelectedItemId(id)}
						onTemplateApplied={loadFile}
					/>
				) : effectiveTab === "timeline" ? (
					<RoadmapTimeline
						items={parsedItems}
						board={board}
						onItemClick={(id) => {
							setSelectedItemId(id);
							setActiveTab("requirements");
						}}
					/>
				) : effectiveTab === "memory" ? (
					<SharedMemoryPanel workspaceId={workspaceId} />
				) : (
					<div className="flex-1 min-w-0 overflow-y-auto bg-surface-0 p-6">
						<div className="px-8">
							{selectedItem ? (
								<SpecTabContent
									item={selectedItem}
									tab={effectiveTab as "requirements" | "design" | "tasks"}
									workspaceId={workspaceId}
									onMouseUp={handleMouseUp}
									onContextMenu={handleContextMenu}
									onNavigateToTask={onNavigateToTask}
									isGenerating={isGenerating}
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
				<SelectionPopover
					popover={popover}
					onStartComment={(text) => {
						setPendingText(text);
						setCommentDraft("");
						setPopover(null);
					}}
				/>
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
						<CommentCard
							anchorText={anchorText}
							relatedComments={relatedComments}
							commentDraft={commentDraft}
							onCommentDraftChange={setCommentDraft}
							onSubmitComment={submitComment}
							onDeleteAnnotation={deleteAnnotation}
							onDismiss={() => {
								setPendingText(null);
								setActiveId(null);
							}}
							style={{ left, top }}
						/>
					);
				})()}
		</div>
	);
}
