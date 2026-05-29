/**
 * Time-series queries over the KPI event log.
 *
 * Pure functions only — caller passes already-loaded events (from
 * `kpi-event-log.ts`) plus the roadmap item id. Splitting the
 * computation out of the IO module keeps the chart code trivially
 * testable and lets the tRPC layer cache events once and feed many
 * queries.
 *
 * The four queries match the Phase C design:
 *   - kpiBurndown    — % of KPIs met over time, one point per
 *                      transition that affects the item.
 *   - kpiVelocity    — KPIs flipped to met per day window.
 *   - kpiCycleTime   — wall-clock minutes from first reading to first
 *                      `met` per KPI.
 *   - kpiRegressions — events where status went met → missed.
 */

import type { KpiEvent } from "./kpi-event-log.js";

export interface BurndownPoint {
	ts: string;
	totalKpis: number;
	metKpis: number;
}

export interface VelocityBucket {
	day: string;
	metCount: number;
}

export interface CycleTimeEntry {
	kpiId: string;
	firstReadingAt: string;
	firstMetAt: string;
	minutes: number;
}

export interface RegressionEntry {
	ts: string;
	kpiId: string;
	statusFrom: "met";
	statusTo: "missed";
}

function projectScopeMatchesItem(event: KpiEvent, itemId: string): boolean {
	return event.scope.kind === "project" && event.scope.itemId === itemId;
}

function kpiIdOf(event: KpiEvent): string | null {
	return event.scope.kind === "project" ? event.scope.kpiId : null;
}

/**
 * `% of declared KPIs met` resampled at every transition that affects
 * the item. The first point sits at the timestamp of the first
 * reading_appended; the last point is the latest transition. UI plots
 * met/total over time.
 *
 * `totalKpis` is taken from the union of distinct kpiIds seen in the
 * log; this is a slight approximation (a KPI declared but never
 * touched won't show up) but matches what the chart should display:
 * the item's "active" KPIs.
 */
export function kpiBurndown(events: readonly KpiEvent[], itemId: string): BurndownPoint[] {
	const transitions = events
		.filter((e) => projectScopeMatchesItem(e, itemId) && e.type === "status_changed")
		.slice()
		.sort((a, b) => a.ts.localeCompare(b.ts));
	if (transitions.length === 0) return [];

	const seenKpis = new Set<string>();
	for (const e of events) {
		if (projectScopeMatchesItem(e, itemId)) {
			const id = kpiIdOf(e);
			if (id) seenKpis.add(id);
		}
	}

	const statusByKpi = new Map<string, "met" | "waived" | "missed" | "open">();
	const points: BurndownPoint[] = [];
	for (const e of transitions) {
		const id = kpiIdOf(e);
		if (!id || !e.statusTo) continue;
		statusByKpi.set(id, e.statusTo);
		let met = 0;
		for (const status of statusByKpi.values()) {
			if (status === "met" || status === "waived") met += 1;
		}
		points.push({ ts: e.ts, totalKpis: seenKpis.size, metKpis: met });
	}
	return points;
}

/**
 * KPIs flipped to `met` per day. `windowDays` controls the lookback
 * window — points outside it are dropped so the chart stays readable
 * for long-running projects. `windowDays = null` keeps everything.
 */
export function kpiVelocity(
	events: readonly KpiEvent[],
	itemId: string,
	windowDays: number | null = 30,
): VelocityBucket[] {
	const flips = events.filter(
		(e) =>
			projectScopeMatchesItem(e, itemId) &&
			e.type === "status_changed" &&
			e.statusTo === "met" &&
			e.statusFrom !== "met",
	);
	const buckets = new Map<string, number>();
	for (const e of flips) {
		const day = e.ts.slice(0, 10);
		buckets.set(day, (buckets.get(day) ?? 0) + 1);
	}
	const entries = [...buckets.entries()]
		.map(([day, metCount]) => ({ day, metCount }))
		.sort((a, b) => a.day.localeCompare(b.day));
	if (windowDays === null) return entries;
	if (entries.length === 0) return entries;
	const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
	const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
	return entries.filter((e) => e.day >= cutoff);
}

/**
 * Per-KPI minutes from `first reading_appended` to `first
 * status_changed -> met`. KPIs that haven't reached `met` yet are
 * omitted. Useful for "how long does a typical KPI take to land."
 */
export function kpiCycleTime(events: readonly KpiEvent[], itemId: string): CycleTimeEntry[] {
	const firstReading = new Map<string, string>();
	const firstMet = new Map<string, string>();
	for (const e of events) {
		if (!projectScopeMatchesItem(e, itemId)) continue;
		const id = kpiIdOf(e);
		if (!id) continue;
		if (e.type === "reading_appended" && !firstReading.has(id)) {
			firstReading.set(id, e.ts);
		}
		if (e.type === "status_changed" && e.statusTo === "met" && !firstMet.has(id)) {
			firstMet.set(id, e.ts);
		}
	}
	const out: CycleTimeEntry[] = [];
	for (const [id, readingTs] of firstReading) {
		const metTs = firstMet.get(id);
		if (!metTs) continue;
		const minutes = Math.max(0, (Date.parse(metTs) - Date.parse(readingTs)) / 60_000);
		out.push({ kpiId: id, firstReadingAt: readingTs, firstMetAt: metTs, minutes });
	}
	return out.sort((a, b) => a.firstMetAt.localeCompare(b.firstMetAt));
}

/**
 * Every transition where a KPI flipped from `met` to `missed`. Drives
 * the regression-alert chip in Phase C3 — but a UI list is also useful
 * standalone.
 */
export function kpiRegressions(events: readonly KpiEvent[], itemId: string): RegressionEntry[] {
	const out: RegressionEntry[] = [];
	for (const e of events) {
		if (!projectScopeMatchesItem(e, itemId)) continue;
		if (e.type !== "status_changed") continue;
		if (e.statusFrom !== "met" || e.statusTo !== "missed") continue;
		const id = kpiIdOf(e);
		if (!id) continue;
		out.push({ ts: e.ts, kpiId: id, statusFrom: "met", statusTo: "missed" });
	}
	return out.sort((a, b) => b.ts.localeCompare(a.ts));
}
