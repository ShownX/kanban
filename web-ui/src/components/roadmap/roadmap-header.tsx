import { ArrowLeft, FilePlus } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RoadmapItem } from "@/types";
import type { TabId } from "./types";

interface RoadmapHeaderProps {
	activeTab: TabId;
	onTabChange: (tab: TabId) => void;
	specItems: RoadmapItem[];
	selectedItemId: string | null;
	selectedItemTitle: string | undefined;
	onSelectItem: (id: string) => void;
	onGenerate: ((prompt: string) => void) | undefined;
	onClose: () => void;
	isGenerating: boolean;
	setIsGenerating: (value: boolean) => void;
	workspaceId: string | null;
	onTemplateApplied?: () => void;
}

export function RoadmapHeader({
	activeTab,
	onTabChange,
	specItems,
	selectedItemId,
	selectedItemTitle,
	onSelectItem,
	onGenerate,
	onClose,
	isGenerating,
	setIsGenerating,
	workspaceId,
	onTemplateApplied,
}: RoadmapHeaderProps): ReactElement {
	const [showNewMenu, setShowNewMenu] = useState(false);
	const newMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!showNewMenu) return;
		const handler = (e: MouseEvent) => {
			if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
				setShowNewMenu(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [showNewMenu]);

	return (
		<div className="flex shrink-0 flex-col border-b border-border bg-surface-1">
			{/* Row 1: Navigation + actions */}
			<div className="flex h-10 items-center gap-1.5 px-3">
				<Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onClose} />
				{/* Tabs */}
				<div className="flex items-center gap-0.5">
					{(
						["roadmap", "requirements", "design", "tasks", "kpis", "timeline", "workspace", "memory"] as const
					).map((tab) => {
						if (tab === "timeline" && !specItems.some((item) => item.startDate || item.endDate)) {
							return null;
						}
						return (
							<button
								key={tab}
								type="button"
								onClick={() => onTabChange(tab)}
								className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors ${activeTab === tab ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary hover:bg-surface-2"}`}
							>
								{tab}
							</button>
						);
					})}
				</div>
				<div className="flex-1" />
				{/* Spec selector */}
				{specItems.length > 0 ? (
					<select
						value={selectedItemId ?? "__overall__"}
						onChange={(e) => {
							const id = e.target.value;
							onSelectItem(id || "__overall__");
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
				{/* New from template */}
				<div className="relative" ref={newMenuRef}>
					<Button
						variant="ghost"
						size="sm"
						icon={<FilePlus size={14} />}
						onClick={() => setShowNewMenu(!showNewMenu)}
					/>
					{showNewMenu && (
						<NewFromTemplateMenu
							workspaceId={workspaceId}
							onApplied={() => {
								setShowNewMenu(false);
								onTemplateApplied?.();
							}}
							onClose={() => setShowNewMenu(false)}
						/>
					)}
				</div>
				{/* Generate */}
				{onGenerate ? (
					<Button
						size="sm"
						onClick={() => {
							const specSlug = selectedItemTitle
								? selectedItemTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")
								: "overall";
							let prompt: string;
							if (activeTab === "requirements") {
								prompt = `Read .kanban/ROADMAP.md and write/update requirements for ${selectedItemTitle ?? "the project"} at .kanban/specs/${specSlug}/requirements.md using EARS notation.`;
							} else if (activeTab === "design") {
								prompt = `Read .kanban/ROADMAP.md and the requirements, then write/update the technical design for ${selectedItemTitle ?? "the project"} at .kanban/specs/${specSlug}/design.md.`;
							} else if (activeTab === "tasks") {
								prompt = `Before generating tasks:\n1. Run \`kanban task list\` to see existing tasks. Do NOT create duplicates.\n2. Read .kanban/ROADMAP.md and the spec at .kanban/specs/${specSlug}/.\n3. Create only tasks that are still needed. Use: kanban task create --prompt "..." --title "..."\n4. Wire dependencies: kanban task link --task-id <waiting> --linked-task-id <prerequisite>\n5. Update .kanban/specs/${specSlug}/tasks.md with the task list.`;
							} else {
								prompt =
									"Read .kanban/ROADMAP.md and the human's latest comments. Update the roadmap based on the comments: revise items, adjust statuses, add new items, or answer questions. Preserve the table structure and all existing columns.";
							}
							onGenerate(prompt);
							setIsGenerating(true);
							setTimeout(() => setIsGenerating(false), 30000);
						}}
					>
						Generate
					</Button>
				) : null}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// New from template dropdown menu
// ---------------------------------------------------------------------------

interface NewFromTemplateMenuProps {
	workspaceId: string | null;
	onApplied: () => void;
	onClose: () => void;
}

interface TemplateSummary {
	id: string;
	name: string;
	description: string;
	itemCount: number;
}

function NewFromTemplateMenu({ workspaceId, onApplied, onClose }: NewFromTemplateMenuProps): ReactElement {
	const [templates, setTemplates] = useState<TemplateSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [applyingId, setApplyingId] = useState<string | null>(null);

	useEffect(() => {
		if (!workspaceId) {
			setLoading(false);
			return;
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		void trpc.runtime.listRoadmapTemplates
			.query()
			.then((result) => setTemplates(result))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [workspaceId]);

	const handleApply = useCallback(
		(templateId: string) => {
			if (!workspaceId || applyingId) return;
			setApplyingId(templateId);
			const trpc = getRuntimeTrpcClient(workspaceId);
			void trpc.runtime.applyRoadmapTemplate
				.mutate({ templateId, force: true })
				.then((result) => {
					if (result.success) {
						toast.success("Template applied — roadmap created");
						onApplied();
					} else {
						toast.error(result.error ?? "Failed to apply template");
					}
				})
				.catch(() => toast.error("Failed to apply template"))
				.finally(() => setApplyingId(null));
		},
		[workspaceId, applyingId, onApplied],
	);

	return (
		<div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-border bg-surface-1 shadow-xl">
			<div className="px-3 py-2 border-b border-border">
				<p className="text-xs font-medium text-text-primary">New from template</p>
				<p className="text-[11px] text-text-tertiary mt-0.5">Creates ROADMAP.md and spec directories</p>
			</div>
			{loading ? (
				<div className="flex items-center justify-center py-4">
					<Spinner size={16} />
				</div>
			) : templates.length === 0 ? (
				<div className="px-3 py-4 text-xs text-text-tertiary text-center">No templates available</div>
			) : (
				<div className="py-1 max-h-64 overflow-y-auto">
					{templates.map((tmpl) => (
						<button
							key={tmpl.id}
							type="button"
							disabled={applyingId !== null}
							onClick={() => handleApply(tmpl.id)}
							className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50 transition-colors"
						>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5">
									<span className="text-xs font-medium text-text-primary">{tmpl.name}</span>
									<span className="text-[10px] text-text-tertiary">{tmpl.itemCount} items</span>
								</div>
								<p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">{tmpl.description}</p>
							</div>
							{applyingId === tmpl.id && <Spinner size={12} className="mt-0.5" />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
