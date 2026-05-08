import { Bot, Check, ChevronDown, ChevronRight, CircleDot, Clock, User } from "lucide-react";
import { type ReactElement, useState } from "react";

import type { BoardCard, BoardColumnId, BoardData, RoadmapItem } from "@/types";

interface RoadmapTasksSummaryProps {
	board: BoardData;
	roadmap: RoadmapItem[];
	agentCreatedTaskIdsByItemId: Record<string, string[]>;
	onOpenCreateTasksDialog?: (itemId: string) => void;
	onPromoteAgentTasks?: (itemId: string, taskIds: string[]) => void;
}

interface TaskRenderInfo {
	taskId: string;
	title: string;
	card: BoardCard | null;
	columnId: BoardColumnId | null;
	agentCreated: boolean;
	promotable: boolean;
}

function findTaskInBoard(board: BoardData, taskId: string): { card: BoardCard; columnId: BoardColumnId } | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return { card, columnId: column.id };
		}
	}
	return null;
}

function formatColumnStatus(columnId: BoardColumnId | null): {
	label: string;
	color: string;
	Icon: typeof CircleDot | typeof Clock | typeof Check;
} {
	if (columnId === "backlog") {
		return { label: "Backlog", color: "text-text-tertiary", Icon: CircleDot };
	}
	if (columnId === "in_progress") {
		return { label: "In Progress", color: "text-status-yellow", Icon: Clock };
	}
	if (columnId === "review") {
		return { label: "Review", color: "text-status-blue", Icon: Clock };
	}
	if (columnId === "trash") {
		return { label: "Done", color: "text-status-green", Icon: Check };
	}
	return { label: "Unknown", color: "text-text-tertiary", Icon: CircleDot };
}

/**
 * Renders a live summary of tasks per roadmap item. Complements the markdown
 * view above by showing card state that lives outside ROADMAP.md:
 *  - Current column (backlog / in_progress / review / done)
 *  - Whether the card was agent-created and not yet promoted to the spec
 */
export function RoadmapTasksSummary({
	board,
	roadmap,
	agentCreatedTaskIdsByItemId,
	onOpenCreateTasksDialog,
	onPromoteAgentTasks,
}: RoadmapTasksSummaryProps): ReactElement | null {
	if (roadmap.length === 0) {
		return null;
	}

	const renderItems = roadmap.map((item) => {
		const promotedIds = new Set(item.tasks.map((ref) => ref.taskId));
		const promoted: TaskRenderInfo[] = item.tasks.map((ref) => {
			const found = findTaskInBoard(board, ref.taskId);
			return {
				taskId: ref.taskId,
				title: ref.title || found?.card.title || ref.taskId,
				card: found?.card ?? null,
				columnId: found?.columnId ?? null,
				agentCreated: ref.agentCreated === true,
				promotable: false,
			};
		});
		const agentOnlyIds = (agentCreatedTaskIdsByItemId[item.id] ?? []).filter((taskId) => !promotedIds.has(taskId));
		const agentOnly: TaskRenderInfo[] = agentOnlyIds.map((taskId) => {
			const found = findTaskInBoard(board, taskId);
			return {
				taskId,
				title: found?.card.title ?? taskId,
				card: found?.card ?? null,
				columnId: found?.columnId ?? null,
				agentCreated: true,
				promotable: found !== null,
			};
		});
		return { item, promoted, agentOnly };
	});

	return (
		<section className="mt-10 border-t border-border pt-6">
			<div className="mb-3">
				<h2 className="text-base font-semibold text-text-primary m-0">Live task status</h2>
				<p className="text-text-secondary text-xs mt-1 mb-0">
					Agent-created tasks are kept separate until you promote them into the spec.
				</p>
			</div>
			{renderItems.map(({ item, promoted, agentOnly }) => {
				const hasAnyTasks = promoted.length + agentOnly.length > 0;
				return (
					<div key={item.id} className="mb-5 rounded-md border border-border bg-surface-1 p-3">
						<div className="flex items-center justify-between gap-2">
							<div className="min-w-0">
								<h3 className="text-sm font-semibold text-text-primary m-0 truncate">{item.title}</h3>
								<p className="text-text-tertiary font-mono text-[11px] m-0">{item.id}</p>
							</div>
						</div>

						<SubsectionDetails item={item} />

						{!hasAnyTasks ? (
							<p className="text-text-tertiary text-xs mt-2 mb-0 italic">No tasks yet.</p>
						) : (
							<ul className="mt-2 mb-0 space-y-1 list-none pl-0">
								{promoted.map((info) => (
									<TaskRow key={info.taskId} info={info} />
								))}
								{agentOnly.map((info) => (
									<TaskRow key={info.taskId} info={info} />
								))}
							</ul>
						)}

						{onPromoteAgentTasks && agentOnly.length > 0 ? (
							<div className="mt-2 flex items-center justify-between gap-2">
								<p className="text-text-tertiary text-xs m-0">
									{agentOnly.length} agent-created task{agentOnly.length === 1 ? "" : "s"} not yet in
									ROADMAP.md.
								</p>
								<button
									type="button"
									onClick={() =>
										onPromoteAgentTasks(
											item.id,
											agentOnly.filter((info) => info.promotable).map((info) => info.taskId),
										)
									}
									className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary hover:bg-surface-3"
								>
									Promote to spec
								</button>
							</div>
						) : null}
					</div>
				);
			})}
		</section>
	);
}

function TaskRow({ info }: { info: TaskRenderInfo }): ReactElement {
	const status = formatColumnStatus(info.columnId);
	const StatusIcon = status.Icon;
	const ProvenanceIcon = info.agentCreated ? Bot : User;
	return (
		<li className="flex items-start gap-2 text-xs">
			<ProvenanceIcon size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
			<code className="shrink-0 text-text-tertiary font-mono">{info.taskId}</code>
			<span className="min-w-0 flex-1 truncate text-text-primary">{info.title || "(untitled)"}</span>
			<StatusIcon size={12} className={`mt-0.5 shrink-0 ${status.color}`} />
			<span className={`shrink-0 ${status.color}`}>{status.label}</span>
			{info.agentCreated && !info.promotable ? null : info.agentCreated && info.promotable ? (
				<span className="shrink-0 rounded bg-surface-3 px-1 py-0.5 text-[10px] text-text-secondary">agent</span>
			) : null}
		</li>
	);
}

function SubsectionDetails({ item }: { item: RoadmapItem }): ReactElement | null {
	const hasContent = item.requirements || item.design || item.openQuestions.length > 0;
	const [expanded, setExpanded] = useState(false);

	if (!hasContent) return null;

	const openCount = item.openQuestions.filter((q) => !q.resolved).length;

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
			>
				{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
				<span>Spec details</span>
				{openCount > 0 ? (
					<span className="ml-1 rounded bg-status-yellow/15 px-1 py-0.5 text-[10px] text-status-yellow">
						{openCount} open question{openCount === 1 ? "" : "s"}
					</span>
				) : null}
			</button>
			{expanded ? (
				<div className="mt-2 space-y-2 border-l-2 border-border pl-3">
					{item.requirements ? (
						<div>
							<h4 className="text-[11px] font-semibold uppercase text-text-tertiary m-0">Requirements</h4>
							<pre className="mt-1 whitespace-pre-wrap text-xs text-text-secondary font-mono bg-surface-0 rounded p-2 m-0 overflow-x-auto">
								{item.requirements}
							</pre>
						</div>
					) : null}
					{item.design ? (
						<div>
							<h4 className="text-[11px] font-semibold uppercase text-text-tertiary m-0">Design</h4>
							<pre className="mt-1 whitespace-pre-wrap text-xs text-text-secondary font-mono bg-surface-0 rounded p-2 m-0 overflow-x-auto">
								{item.design}
							</pre>
						</div>
					) : null}
					{item.openQuestions.length > 0 ? (
						<div>
							<h4 className="text-[11px] font-semibold uppercase text-text-tertiary m-0">Open questions</h4>
							<ul className="mt-1 list-none pl-0 space-y-0.5 m-0">
								{item.openQuestions.map((q) => (
									<li key={q.id} className="flex items-start gap-1.5 text-xs">
										<span className={q.resolved ? "text-status-green" : "text-status-yellow"}>
											{q.resolved ? "✓" : "?"}
										</span>
										<span className={q.resolved ? "text-text-tertiary line-through" : "text-text-primary"}>
											{q.text}
										</span>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
