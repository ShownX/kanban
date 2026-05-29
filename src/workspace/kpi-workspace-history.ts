/**
 * Workspace-wide queries that aggregate per-item KPI data.
 *
 * Pure functions only. The tRPC layer reads the event log + state
 * once, fans out to per-item snapshots via the existing helpers, and
 * passes the materialized data to these aggregators. Splits the
 * compute out of the IO module so the dashboard logic is trivially
 * testable.
 *
 * Queries:
 *   - workspaceKpiSummary  — totals across every item.
 *   - oldestOpenKpis       — top N stale open KPIs sorted by age.
 *   - workspaceVelocity    — per-day met-flips summed across items.
 */

import type { KpiEvent } from "./kpi-event-log.js";
import type { KpiSnapshot } from "./kpi-snapshot.js";

export interface PerItemSnapshotInput {
	itemId: string;
	snapshot: KpiSnapshot;
	regressionCount: number;
}

export interface WorkspaceKpiSummary {
	totalItems: number;
	totalKpis: number;
	metKpis: number;
	regressionCount: number;
	blockedItemIds: string[];
}

export interface OldestOpenEntry {
	roadmapItemId: string;
	kpiId: string;
	openedAt: string;
	daysOpen: number;
}

export interface WorkspaceVelocityBucket {
	day: string;
	metCount: number;
}

export function workspaceKpiSummary(perItem: readonly PerItemSnapshotInput[]): WorkspaceKpiSummary {
	let totalKpis = 0;
	let metKpis = 0;
	let regressionCount = 0;
	const blockedItemIds: string[] = [];
	for (const entry of perItem) {
		const items = entry.snapshot.kpis;
		totalKpis += items.length;
		for (const item of items) {
			if (item.evaluation.status === "met" || item.evaluation.status === "waived") metKpis += 1;
		}
		regressionCount += entry.regressionCount;
		if (!entry.snapshot.allMet && entry.snapshot.kpis.length > 0) {
			blockedItemIds.push(entry.itemId);
		}
	}
	return {
		totalItems: perItem.length,
		totalKpis,
		metKpis,
		regressionCount,
		blockedItemIds,
	};
}

/**
 * Top N KPIs that are still in `open` status, sorted by `openedAt`
 * ascending (oldest first).
 *
 * Resolution rules:
 *   - "Open" = current evaluated status is `open`. KPIs that are
 *     missed/met/waived are excluded — they have a verdict.
 *   - "OpenedAt" = the timestamp of the first event that mentions
 *     the KPI in the log. For a KPI declared in markdown but never
 *     touched, no events exist, so we omit it (the dashboard's
 *     project-rollup table already counts it under "blocked").
 *   - `now` is taken from the most recent event timestamp, falling
 *     back to wall-clock when the log is empty. Using event time
 *     keeps the function pure under test.
 */
export function oldestOpenKpis(
	events: readonly KpiEvent[],
	perItem: readonly PerItemSnapshotInput[],
	limit = 10,
	nowMs?: number,
): OldestOpenEntry[] {
	const firstSeen = new Map<string, string>(); // key = `${itemId}/${kpiId}` (project scope only).
	for (const event of events) {
		if (event.scope.kind !== "project") continue;
		const key = `${event.scope.itemId}/${event.scope.kpiId}`;
		if (!firstSeen.has(key)) firstSeen.set(key, event.ts);
	}

	const referenceMs =
		nowMs !== undefined ? nowMs : events.length > 0 ? Math.max(...events.map((e) => Date.parse(e.ts))) : Date.now();

	const entries: OldestOpenEntry[] = [];
	for (const item of perItem) {
		for (const kpi of item.snapshot.kpis) {
			if (kpi.evaluation.status !== "open") continue;
			const openedAt = firstSeen.get(`${item.itemId}/${kpi.definition.id}`);
			if (!openedAt) continue;
			const daysOpen = Math.max(0, Math.floor((referenceMs - Date.parse(openedAt)) / (24 * 60 * 60 * 1000)));
			entries.push({ roadmapItemId: item.itemId, kpiId: kpi.definition.id, openedAt, daysOpen });
		}
	}
	entries.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
	return entries.slice(0, limit);
}

/**
 * Sum met-flips per day across all items in the workspace, restricted
 * to the last `windowDays`. `null` means no window (return everything).
 *
 * Drops the same "re-confirm" cases the per-item velocity query drops:
 * `statusFrom: "met"` doesn't represent a new met-flip.
 */
export function workspaceVelocity(
	events: readonly KpiEvent[],
	windowDays: number | null = 30,
): WorkspaceVelocityBucket[] {
	const buckets = new Map<string, number>();
	for (const event of events) {
		if (event.scope.kind !== "project") continue;
		if (event.type !== "status_changed") continue;
		if (event.statusTo !== "met") continue;
		if (event.statusFrom === "met") continue;
		const day = event.ts.slice(0, 10);
		buckets.set(day, (buckets.get(day) ?? 0) + 1);
	}
	const sorted = [...buckets.entries()]
		.map(([day, metCount]) => ({ day, metCount }))
		.sort((a, b) => a.day.localeCompare(b.day));
	if (windowDays === null || sorted.length === 0) return sorted;
	const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
	const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
	return sorted.filter((b) => b.day >= cutoff);
}
