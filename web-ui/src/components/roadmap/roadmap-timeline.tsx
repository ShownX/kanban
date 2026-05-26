import type { ReactElement } from "react";
import { useMemo, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type { BoardCard, BoardData, RoadmapItem } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoadmapTimelineProps {
	items: RoadmapItem[];
	board: BoardData;
	onItemClick?: (itemId: string) => void;
}

interface TimelineRow {
	id: string;
	title: string;
	startDate: Date | null;
	endDate: Date | null;
	status: string;
	isMilestone: boolean;
	isSubtask: boolean;
	parentId?: string;
}

interface TimelineDependencyEdge {
	fromItemId: string;
	toItemId: string;
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PX_PER_DAY = 4;
const LEFT_COL_WIDTH = 200;
const BAR_HEIGHT = 24;
const SUBTASK_BAR_HEIGHT = 16;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 48;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(dateStr: string | undefined): Date | null {
	if (!dateStr) return null;
	const d = new Date(dateStr + "T00:00:00");
	return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
	return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMonthYear(d: Date): string {
	return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatDate(d: Date): string {
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusColor(status: string): string {
	switch (status) {
		case "in_progress":
			return "var(--color-status-orange)";
		case "done":
			return "var(--color-status-green)";
		default:
			return "var(--color-status-blue)";
	}
}

function columnStatusColor(columnId: string): string {
	switch (columnId) {
		case "in_progress":
			return "var(--color-status-orange)";
		case "review":
			return "var(--color-status-blue)";
		case "trash":
			return "var(--color-status-green)";
		default:
			return "var(--color-text-tertiary)";
	}
}

/**
 * Resolve linked board cards for a roadmap item, returning each card with its column ID.
 */
function findLinkedCards(item: RoadmapItem, board: BoardData): Array<{ card: BoardCard; columnId: string }> {
	if (item.linkedTaskIds.length === 0) return [];
	const linkedIdSet = new Set(item.linkedTaskIds);
	const results: Array<{ card: BoardCard; columnId: string }> = [];
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (linkedIdSet.has(card.id)) {
				results.push({ card, columnId: column.id });
			}
		}
	}
	return results;
}

/**
 * Build timeline rows from roadmap items, expanding subtasks beneath each parent.
 */
function buildRows(items: RoadmapItem[], board: BoardData): TimelineRow[] {
	const rows: TimelineRow[] = [];

	for (const item of items) {
		let start = parseDate(item.startDate);
		let end = parseDate(item.endDate);

		// Swap if inverted
		if (start && end && start > end) {
			[start, end] = [end, start];
		}

		rows.push({
			id: item.id,
			title: item.title,
			startDate: start,
			endDate: end,
			status: item.status,
			isMilestone: item.milestone === true,
			isSubtask: false,
		});

		// Expand linked sub-tasks
		const linkedCards = findLinkedCards(item, board);
		if (linkedCards.length > 0 && start && end) {
			const parentDays = daysBetween(start, end);
			const taskCount = linkedCards.length;

			linkedCards.forEach(({ card, columnId }, idx) => {
				// Spread subtasks evenly within the parent's date range
				const taskStart = new Date(start.getTime());
				taskStart.setDate(taskStart.getDate() + Math.floor((parentDays * idx) / taskCount));
				const taskEnd = new Date(start.getTime());
				taskEnd.setDate(taskEnd.getDate() + Math.floor((parentDays * (idx + 1)) / taskCount));

				rows.push({
					id: card.id,
					title: card.title,
					startDate: taskStart,
					endDate: taskEnd,
					status: columnId,
					isMilestone: false,
					isSubtask: true,
					parentId: item.id,
				});
			});
		}
	}

	return rows;
}

/**
 * Compute the overall date range from all rows, padded by 7 days on each side.
 */
function computeRange(rows: TimelineRow[]): { rangeStart: Date; rangeEnd: Date } | null {
	let min: Date | null = null;
	let max: Date | null = null;

	for (const row of rows) {
		if (row.startDate) {
			if (!min || row.startDate < min) min = row.startDate;
			if (!max || row.startDate > max) max = row.startDate;
		}
		if (row.endDate) {
			if (!min || row.endDate < min) min = row.endDate;
			if (!max || row.endDate > max) max = row.endDate;
		}
	}

	if (!min || !max) return null;

	const rangeStart = new Date(min);
	rangeStart.setDate(rangeStart.getDate() - 7);

	const rangeEnd = new Date(max);
	rangeEnd.setDate(rangeEnd.getDate() + 7);

	return { rangeStart, rangeEnd };
}

/**
 * Generate month boundaries within a date range for rendering headers and gridlines.
 */
function getMonthBoundaries(rangeStart: Date, rangeEnd: Date): Array<{ date: Date; label: string; offsetPx: number }> {
	const months: Array<{ date: Date; label: string; offsetPx: number }> = [];
	const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);

	while (cursor <= rangeEnd) {
		const offsetDays = daysBetween(rangeStart, cursor);
		if (offsetDays >= 0) {
			months.push({
				date: new Date(cursor),
				label: formatMonthYear(cursor),
				offsetPx: offsetDays * PX_PER_DAY,
			});
		}
		cursor.setMonth(cursor.getMonth() + 1);
	}

	return months;
}

/**
 * Generate week gridline positions.
 */
function getWeekLines(rangeStart: Date, rangeEnd: Date): number[] {
	const lines: number[] = [];
	// Start from the next Monday after rangeStart
	const cursor = new Date(rangeStart);
	const dayOfWeek = cursor.getDay();
	const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
	cursor.setDate(cursor.getDate() + daysUntilMonday);

	while (cursor <= rangeEnd) {
		lines.push(daysBetween(rangeStart, cursor) * PX_PER_DAY);
		cursor.setDate(cursor.getDate() + 7);
	}

	return lines;
}

// ---------------------------------------------------------------------------
// Dependency edge computation
// ---------------------------------------------------------------------------

/**
 * Build a map from task card ID to the roadmap item ID it belongs to.
 * Uses both `RoadmapItem.linkedTaskIds` and `BoardCard.roadmapItemId`.
 */
function buildTaskToItemMap(items: RoadmapItem[], board: BoardData): Map<string, string> {
	const map = new Map<string, string>();

	// From roadmap item linkedTaskIds
	for (const item of items) {
		for (const taskId of item.linkedTaskIds) {
			map.set(taskId, item.id);
		}
	}

	// From card.roadmapItemId (takes precedence since it's explicit on the card)
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (card.roadmapItemId) {
				map.set(card.id, card.roadmapItemId);
			}
		}
	}

	return map;
}

/**
 * Compute the pixel rectangle for a timeline row's bar given its position in the display list.
 */
function computeBarRect(
	row: TimelineRow,
	rowIndex: number,
	rangeStart: Date,
): { left: number; top: number; width: number; height: number } | null {
	if (row.isMilestone) {
		const date = row.endDate ?? row.startDate;
		if (!date) return null;
		const offsetDays = daysBetween(rangeStart, date);
		const size = 12;
		return {
			left: offsetDays * PX_PER_DAY - size / 2,
			top: rowIndex * ROW_HEIGHT + (ROW_HEIGHT - size) / 2,
			width: size,
			height: size,
		};
	}

	if (!row.startDate || !row.endDate) return null;

	const offsetDays = daysBetween(rangeStart, row.startDate);
	const durationDays = Math.max(daysBetween(row.startDate, row.endDate), 1);
	const barH = row.isSubtask ? SUBTASK_BAR_HEIGHT : BAR_HEIGHT;
	const topOffset = row.isSubtask ? (ROW_HEIGHT - SUBTASK_BAR_HEIGHT) / 2 : (ROW_HEIGHT - BAR_HEIGHT) / 2;

	return {
		left: offsetDays * PX_PER_DAY,
		top: rowIndex * ROW_HEIGHT + topOffset,
		width: Math.max(durationDays * PX_PER_DAY, 4),
		height: barH,
	};
}

/**
 * Compute dependency edges between timeline rows based on board dependencies.
 *
 * For each board dependency, resolves both task card IDs to their parent roadmap items.
 * If the two tasks belong to different roadmap items that both have visible bars,
 * produces an edge from the right edge of the prerequisite bar to the left edge
 * of the dependent bar.
 */
function computeDependencyEdges(
	items: RoadmapItem[],
	board: BoardData,
	allDisplayRows: TimelineRow[],
	rangeStart: Date,
): TimelineDependencyEdge[] {
	if (board.dependencies.length === 0) return [];

	const taskToItem = buildTaskToItemMap(items, board);

	// Build a map from row ID to its index in allDisplayRows
	const rowIndexMap = new Map<string, number>();
	for (let i = 0; i < allDisplayRows.length; i++) {
		const row = allDisplayRows[i];
		if (row) rowIndexMap.set(row.id, i);
	}

	// Deduplicate: multiple task-level deps between the same two roadmap items
	// should produce only one arrow
	const seen = new Set<string>();
	const edges: TimelineDependencyEdge[] = [];

	for (const dep of board.dependencies) {
		const fromItemId = taskToItem.get(dep.fromTaskId);
		const toItemId = taskToItem.get(dep.toTaskId);

		// Both tasks must map to roadmap items
		if (!fromItemId || !toItemId) continue;

		// Skip same-item (internal) dependencies
		if (fromItemId === toItemId) continue;

		// Deduplicate
		const edgeKey = `${fromItemId}->${toItemId}`;
		if (seen.has(edgeKey)) continue;
		seen.add(edgeKey);

		// Find the rows for these items (use the parent roadmap item row, not subtask rows)
		const fromIdx = rowIndexMap.get(fromItemId);
		const toIdx = rowIndexMap.get(toItemId);
		if (fromIdx === undefined || toIdx === undefined) continue;

		const fromRow = allDisplayRows[fromIdx] as TimelineRow | undefined;
		const toRow = allDisplayRows[toIdx] as TimelineRow | undefined;
		if (!fromRow || !toRow) continue;

		const fromRect = computeBarRect(fromRow, fromIdx, rangeStart);
		const toRect = computeBarRect(toRow, toIdx, rangeStart);

		// Both items must have visible bars
		if (!fromRect || !toRect) continue;

		edges.push({
			fromItemId,
			toItemId,
			fromX: fromRect.left + fromRect.width,
			fromY: fromRect.top + fromRect.height / 2,
			toX: toRect.left,
			toY: toRect.top + toRect.height / 2,
		});
	}

	return edges;
}

// ---------------------------------------------------------------------------
// Dependency arrow SVG component
// ---------------------------------------------------------------------------

const ARROW_MARKER_ID = "dep-arrowhead";

function DependencyArrowDefs(): ReactElement {
	return (
		<defs>
			<marker
				id={ARROW_MARKER_ID}
				markerWidth="8"
				markerHeight="6"
				refX="8"
				refY="3"
				orient="auto"
				markerUnits="userSpaceOnUse"
			>
				<path d="M0,0 L8,3 L0,6 Z" fill="var(--color-text-tertiary)" opacity={0.6} />
			</marker>
		</defs>
	);
}

function DependencyArrow({ edge }: { edge: TimelineDependencyEdge }): ReactElement {
	const { fromX, fromY, toX, toY } = edge;

	// Compute cubic bezier control points for a smooth S-curve
	const dx = toX - fromX;
	const cpOffset = Math.max(Math.abs(dx) * 0.3, 20);

	const path = `M ${fromX},${fromY} C ${fromX + cpOffset},${fromY} ${toX - cpOffset},${toY} ${toX},${toY}`;

	return (
		<path
			d={path}
			fill="none"
			stroke="var(--color-text-tertiary)"
			strokeWidth={1.5}
			strokeOpacity={0.6}
			markerEnd={`url(#${ARROW_MARKER_ID})`}
		/>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TimelineBar({
	row,
	rangeStart,
	onClick,
}: {
	row: TimelineRow;
	rangeStart: Date;
	onClick?: () => void;
}): ReactElement | null {
	if (!row.startDate || !row.endDate) return null;

	const start = row.startDate;
	const end = row.endDate;
	const offsetDays = daysBetween(rangeStart, start);
	const durationDays = Math.max(daysBetween(start, end), 1);
	const leftPx = offsetDays * PX_PER_DAY;
	const widthPx = durationDays * PX_PER_DAY;
	const color = row.isSubtask ? columnStatusColor(row.status) : statusColor(row.status);
	const height = row.isSubtask ? SUBTASK_BAR_HEIGHT : BAR_HEIGHT;
	const topOffset = row.isSubtask ? (ROW_HEIGHT - SUBTASK_BAR_HEIGHT) / 2 : (ROW_HEIGHT - BAR_HEIGHT) / 2;

	const tooltipContent = (
		<div className="space-y-0.5">
			<div className="font-medium">{row.title}</div>
			<div className="font-mono text-text-secondary">
				{formatDate(start)} — {formatDate(end)}
			</div>
			<div className="capitalize text-text-secondary">{row.status.replace(/_/g, " ")}</div>
		</div>
	);

	return (
		<Tooltip content={tooltipContent} side="top">
			<button
				type="button"
				onClick={onClick}
				className="absolute rounded-sm transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
				style={{
					left: leftPx,
					top: topOffset,
					width: widthPx,
					height,
					backgroundColor: color,
					minWidth: 4,
				}}
			/>
		</Tooltip>
	);
}

function MilestoneDiamond({
	row,
	rangeStart,
	onClick,
}: {
	row: TimelineRow;
	rangeStart: Date;
	onClick?: () => void;
}): ReactElement | null {
	const date = row.endDate ?? row.startDate;
	if (!date) return null;

	const offsetDays = daysBetween(rangeStart, date);
	const leftPx = offsetDays * PX_PER_DAY;
	const color = statusColor(row.status);
	const size = 12;

	const tooltipContent = (
		<div className="space-y-0.5">
			<div className="font-medium">{row.title}</div>
			<div className="font-mono text-text-secondary">{formatDate(date)}</div>
			<div className="text-text-secondary">Milestone</div>
		</div>
	);

	return (
		<Tooltip content={tooltipContent} side="top">
			<button
				type="button"
				onClick={onClick}
				className="absolute transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
				style={{
					left: leftPx - size / 2,
					top: (ROW_HEIGHT - size) / 2,
					width: size,
					height: size,
					backgroundColor: color,
					transform: "rotate(45deg)",
					borderRadius: 2,
				}}
			/>
		</Tooltip>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RoadmapTimeline({ items, board, onItemClick }: RoadmapTimelineProps): ReactElement {
	const scrollRef = useRef<HTMLDivElement>(null);

	const rows = useMemo(() => buildRows(items, board), [items, board]);
	const datedRows = useMemo(() => rows.filter((r) => r.startDate || r.endDate), [rows]);
	const undatedRows = useMemo(() => rows.filter((r) => !r.startDate && !r.endDate && !r.isSubtask), [rows]);

	const range = useMemo(() => computeRange(datedRows), [datedRows]);
	const allDisplayRows = useMemo(() => [...datedRows, ...undatedRows], [datedRows, undatedRows]);
	const dependencyEdges = useMemo(
		() => computeDependencyEdges(items, board, allDisplayRows, range?.rangeStart ?? new Date()),
		[items, board, allDisplayRows, range],
	);

	if (!range || datedRows.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-text-tertiary text-sm py-16">
				No roadmap items with dates to display on the timeline.
			</div>
		);
	}

	const { rangeStart, rangeEnd } = range;
	const totalDays = daysBetween(rangeStart, rangeEnd);
	const totalWidth = totalDays * PX_PER_DAY;
	const months = getMonthBoundaries(rangeStart, rangeEnd);
	const weekLines = getWeekLines(rangeStart, rangeEnd);

	// Today line
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const todayOffset = daysBetween(rangeStart, today);
	const todayPx = todayOffset * PX_PER_DAY;
	const showToday = todayOffset >= 0 && todayOffset <= totalDays;

	const bodyHeight = allDisplayRows.length * ROW_HEIGHT;

	return (
		<div className="flex flex-1 min-h-0 min-w-0 overflow-hidden bg-surface-0">
			{/* Fixed left column: row labels */}
			<div
				className="shrink-0 border-r border-border bg-surface-1 overflow-hidden"
				style={{ width: LEFT_COL_WIDTH }}
			>
				{/* Header spacer */}
				<div
					className="border-b border-border flex items-end px-3 pb-1 text-xs font-medium text-text-secondary"
					style={{ height: HEADER_HEIGHT }}
				>
					Item
				</div>
				{/* Row labels */}
				<div className="overflow-hidden">
					{allDisplayRows.map((row) => (
						<button
							key={row.id}
							type="button"
							onClick={() => onItemClick?.(row.isSubtask && row.parentId ? row.parentId : row.id)}
							className={cn(
								"flex items-center w-full text-left text-xs truncate hover:bg-surface-3 transition-colors",
								row.isSubtask ? "pl-8 text-text-tertiary" : "pl-3 text-text-primary font-medium",
							)}
							style={{ height: ROW_HEIGHT }}
							title={row.title}
						>
							{row.title}
						</button>
					))}
					{undatedRows.length > 0 && (
						<div
							className="flex items-center px-3 text-xs text-text-tertiary italic border-t border-border"
							style={{ height: ROW_HEIGHT, marginTop: datedRows.length > 0 ? 0 : undefined }}
						>
							{/* The "No dates" separator is implicit from the border above */}
						</div>
					)}
				</div>
			</div>

			{/* Scrollable timeline area */}
			<div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
				<div style={{ width: totalWidth, minHeight: HEADER_HEIGHT + bodyHeight }}>
					{/* Month headers */}
					<div className="relative border-b border-border" style={{ height: HEADER_HEIGHT }}>
						{months.map((m) => (
							<div
								key={m.label}
								className="absolute top-0 flex items-end pb-1 text-xs font-medium text-text-secondary border-l border-border pl-1.5"
								style={{ left: m.offsetPx, height: HEADER_HEIGHT }}
							>
								{m.label}
							</div>
						))}
						{/* Today label */}
						{showToday && (
							<div
								className="absolute bottom-1 text-[10px] font-medium"
								style={{
									left: todayPx - 14,
									color: "var(--color-accent)",
								}}
							>
								Today
							</div>
						)}
					</div>

					{/* Timeline body */}
					<div className="relative" style={{ height: bodyHeight }}>
						{/* Week gridlines */}
						{weekLines.map((x) => (
							<div
								key={x}
								className="absolute top-0 w-px bg-border"
								style={{ left: x, height: bodyHeight, opacity: 0.4 }}
							/>
						))}

						{/* Month gridlines */}
						{months.map((m) => (
							<div
								key={`grid-${m.label}`}
								className="absolute top-0 w-px bg-border-bright"
								style={{ left: m.offsetPx, height: bodyHeight, opacity: 0.5 }}
							/>
						))}

						{/* Today line */}
						{showToday && (
							<div
								className="absolute top-0 w-px"
								style={{
									left: todayPx,
									height: bodyHeight,
									borderLeft: "1px dashed var(--color-accent)",
									opacity: 0.5,
								}}
							/>
						)}

						{/* Row backgrounds (alternating subtle stripes) */}
						{allDisplayRows.map((row, idx) => (
							<div
								key={`bg-${row.id}`}
								className="absolute w-full"
								style={{
									top: idx * ROW_HEIGHT,
									height: ROW_HEIGHT,
									backgroundColor: idx % 2 === 1 ? "rgba(255,255,255,0.02)" : "transparent",
								}}
							/>
						))}

						{/* Undated section separator */}
						{undatedRows.length > 0 && datedRows.length > 0 && (
							<div
								className="absolute w-full border-t border-border"
								style={{ top: datedRows.length * ROW_HEIGHT }}
							/>
						)}

						{/* Bars and milestones */}
						{allDisplayRows.map((row, idx) => (
							<div
								key={`bar-${row.id}`}
								className="absolute"
								style={{
									top: idx * ROW_HEIGHT,
									height: ROW_HEIGHT,
									width: totalWidth,
								}}
							>
								{row.isMilestone ? (
									<MilestoneDiamond row={row} rangeStart={rangeStart} onClick={() => onItemClick?.(row.id)} />
								) : (
									<TimelineBar
										row={row}
										rangeStart={rangeStart}
										onClick={() => onItemClick?.(row.isSubtask && row.parentId ? row.parentId : row.id)}
									/>
								)}
							</div>
						))}

						{/* Dependency arrows */}
						{dependencyEdges.length > 0 && (
							<svg
								className="absolute inset-0 pointer-events-none"
								style={{ overflow: "visible", width: totalWidth, height: bodyHeight }}
							>
								<DependencyArrowDefs />
								{dependencyEdges.map((edge) => (
									<DependencyArrow key={`${edge.fromItemId}-${edge.toItemId}`} edge={edge} />
								))}
							</svg>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
