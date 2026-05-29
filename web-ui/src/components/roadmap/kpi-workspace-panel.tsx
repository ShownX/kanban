/**
 * Workspace-wide KPI dashboard. Aggregates per-item rollups, oldest-open
 * KPIs, recent regressions, and workspace velocity into one view.
 *
 * Reuses the C2 chart primitives (VelocityChart) and the per-item
 * regression/cycle-time list shapes; this panel is mostly composition
 * + a project-rollup table that's specific to this surface.
 */

import type { RuntimeKpiWorkspaceDashboardResponse } from "@runtime-contract";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { VelocityChart } from "./kpi-history-charts";
import { useKpiWorkspaceDashboard } from "./use-kpi-workspace-dashboard";

interface KpiWorkspacePanelProps {
	workspaceId: string | null;
	onSelectItem?: (roadmapItemId: string) => void;
}

export function KpiWorkspacePanel({ workspaceId, onSelectItem }: KpiWorkspacePanelProps): ReactElement {
	const { dashboard, loading, error, reload } = useKpiWorkspaceDashboard(workspaceId);

	if (loading && !dashboard) {
		return (
			<div className="flex flex-1 items-center justify-center py-16">
				<Spinner size={20} />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-1 items-center justify-center text-status-red text-sm py-16">
				Failed to load workspace KPIs: {error}
			</div>
		);
	}

	if (!dashboard || dashboard.summary.totalKpis === 0) {
		return <EmptyState onRefresh={reload} />;
	}

	return (
		<div className="flex-1 min-w-0 overflow-y-auto bg-surface-0 p-6">
			<div className="max-w-3xl mx-auto space-y-4">
				<Header summary={dashboard.summary} onRefresh={reload} loading={loading} />
				<ProjectRollupTable perItem={dashboard.perItem} onSelectItem={onSelectItem ?? (() => {})} />
				<OldestOpenList entries={dashboard.oldestOpen} onSelectItem={onSelectItem ?? (() => {})} />
				<RecentRegressionsList entries={dashboard.recentRegressions} onSelectItem={onSelectItem ?? (() => {})} />
				<VelocityChart buckets={dashboard.velocity} />
			</div>
		</div>
	);
}

function EmptyState({ onRefresh }: { onRefresh: () => Promise<void> }): ReactElement {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-tertiary text-sm py-16">
			<p>No KPIs declared anywhere in this workspace.</p>
			<p className="text-xs text-text-tertiary">
				Add a <code className="bg-surface-2 px-1 rounded-sm">### KPIs</code> section to{" "}
				<code className="bg-surface-2 px-1 rounded-sm">.kanban/kpis/&lt;item-id&gt;.md</code> on any roadmap item.
			</p>
			<Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void onRefresh()}>
				Refresh
			</Button>
		</div>
	);
}

function Header({
	summary,
	onRefresh,
	loading,
}: {
	summary: RuntimeKpiWorkspaceDashboardResponse["summary"];
	onRefresh: () => Promise<void>;
	loading: boolean;
}): ReactElement {
	const allMet = summary.blockedItemIds.length === 0 && summary.regressionCount === 0;
	return (
		<div className="flex items-start justify-between gap-2">
			<div>
				<h2 className="text-sm font-semibold text-text-primary">Workspace KPIs</h2>
				<p className="text-xs text-text-tertiary mt-1">
					{summary.metKpis}/{summary.totalKpis} met across {summary.totalItems} project
					{summary.totalItems === 1 ? "" : "s"}
					{summary.regressionCount > 0
						? ` · ${summary.regressionCount} regression${summary.regressionCount === 1 ? "" : "s"}`
						: ""}
					{summary.blockedItemIds.length > 0
						? ` · ${summary.blockedItemIds.length} blocked`
						: allMet
							? " · all clear"
							: ""}
				</p>
			</div>
			<Button
				size="sm"
				variant="ghost"
				icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
				onClick={() => void onRefresh()}
			>
				Refresh
			</Button>
		</div>
	);
}

function ProjectRollupTable({
	perItem,
	onSelectItem,
}: {
	perItem: RuntimeKpiWorkspaceDashboardResponse["perItem"];
	onSelectItem: (id: string) => void;
}): ReactElement {
	const withKpis = perItem.filter((item) => item.total > 0);
	if (withKpis.length === 0) {
		return (
			<div className="rounded-md border border-border bg-surface-1 p-3 text-xs text-text-tertiary">
				No roadmap items declare KPIs.
			</div>
		);
	}
	return (
		<div className="rounded-md border border-border bg-surface-1 overflow-hidden">
			<div className="px-3 py-2 text-xs font-medium text-text-primary border-b border-border">Project rollup</div>
			<ul className="divide-y divide-border">
				{withKpis.map((item) => {
					const allMet = item.blockingIds.length === 0;
					const statusClass = allMet
						? "bg-status-green/15 text-status-green"
						: "bg-status-orange/15 text-status-orange";
					return (
						<li key={item.itemId}>
							<button
								type="button"
								onClick={() => onSelectItem(item.itemId)}
								className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-3 transition-colors"
							>
								<div className="min-w-0 flex-1">
									<div className="text-xs font-medium text-text-primary truncate">{item.itemId}</div>
									{item.blockingIds.length > 0 ? (
										<div className="text-[10px] text-text-tertiary truncate mt-0.5">
											blocking: {item.blockingIds.slice(0, 3).join(", ")}
											{item.blockingIds.length > 3 ? ` (+${item.blockingIds.length - 3})` : ""}
										</div>
									) : null}
								</div>
								<div className="flex items-center gap-2 shrink-0">
									{item.regressionCount > 0 ? (
										<span className="text-[10px] text-status-red">{item.regressionCount} reg.</span>
									) : null}
									<span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", statusClass)}>
										{item.met}/{item.total}
									</span>
								</div>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function OldestOpenList({
	entries,
	onSelectItem,
}: {
	entries: RuntimeKpiWorkspaceDashboardResponse["oldestOpen"];
	onSelectItem: (id: string) => void;
}): ReactElement {
	if (entries.length === 0) {
		return (
			<div className="rounded-md border border-border bg-surface-1 p-3">
				<div className="text-xs font-medium text-text-primary mb-1">Oldest open KPIs</div>
				<div className="text-xs text-text-tertiary">No open KPIs.</div>
			</div>
		);
	}
	return (
		<div className="rounded-md border border-border bg-surface-1">
			<div className="px-3 py-2 text-xs font-medium text-text-primary border-b border-border">
				Oldest open KPIs ({entries.length})
			</div>
			<ul className="divide-y divide-border">
				{entries.map((entry) => (
					<li key={`${entry.roadmapItemId}/${entry.kpiId}`}>
						<button
							type="button"
							onClick={() => onSelectItem(entry.roadmapItemId)}
							className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-3 transition-colors"
						>
							<div className="min-w-0">
								<div className="text-xs font-medium text-text-primary truncate">{entry.kpiId}</div>
								<div className="text-[10px] text-text-tertiary truncate">{entry.roadmapItemId}</div>
							</div>
							<span className="shrink-0 text-[10px] text-text-tertiary tabular-nums">
								{entry.daysOpen} day{entry.daysOpen === 1 ? "" : "s"}
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

function RecentRegressionsList({
	entries,
	onSelectItem,
}: {
	entries: RuntimeKpiWorkspaceDashboardResponse["recentRegressions"];
	onSelectItem: (id: string) => void;
}): ReactElement {
	if (entries.length === 0) {
		return (
			<div className="rounded-md border border-border bg-surface-1 p-3">
				<div className="text-xs font-medium text-text-primary mb-1">Recent regressions</div>
				<div className="text-xs text-text-tertiary">No regressions in this window.</div>
			</div>
		);
	}
	return (
		<div className="rounded-md border border-status-red/30 bg-status-red/5">
			<div className="px-3 py-2 text-xs font-medium text-status-red border-b border-status-red/30 flex items-center gap-2">
				<AlertCircle size={12} />
				Recent regressions ({entries.length})
			</div>
			<ul className="divide-y divide-status-red/20">
				{entries.map((entry) => (
					<li key={`${entry.roadmapItemId}/${entry.kpiId}/${entry.ts}`}>
						<button
							type="button"
							onClick={() => onSelectItem(entry.roadmapItemId)}
							className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-status-red/10 transition-colors"
						>
							<div className="min-w-0">
								<div className="text-xs font-medium text-text-primary truncate">{entry.kpiId}</div>
								<div className="text-[10px] text-text-tertiary truncate">{entry.roadmapItemId}</div>
							</div>
							<span className="shrink-0 text-[10px] text-text-tertiary tabular-nums">
								{entry.ts.slice(0, 16).replace("T", " ")}
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
