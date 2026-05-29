# Project KPI tracking — Phase D design

Phase B + C shipped the per-item KPI surface end-to-end. What's still
missing — and what real users start asking for once a workspace has a
handful of roadmap items — is the **workspace-wide picture**:

- "Across all projects, what fraction of KPIs are met?"
- "Which projects have the most regressions?"
- "Show me every open KPI that's been open the longest."

This document covers Phase D: a workspace-wide dashboard that reuses
the C2 history queries, plus a retention story for the C1 event log so
files don't grow forever.

It explicitly does **not** cover external metric exporters (Prometheus /
Grafana / OpenTelemetry) or alerting outside the existing in-app chip
(email / Slack / PagerDuty). Both wait for a concrete user with a
concrete target — there's no schema work that's load-bearing without
one.

This is a design-only commit. Implementation lands on follow-on
branches once the design has been reviewed.

## What lives on top of Phase C

Phase C already gives us:

- A per-item snapshot (`getKpiSnapshot`) and per-item history
  (`getKpiHistory`) that returns burndown / velocity / cycle time /
  regressions.
- A bulk rollup procedure (`getKpiRollups`) used by the board pills.
- A KPI panel with Snapshot and History subtabs, scoped to one
  roadmap item.
- A regression alert chip in the top bar that's already
  workspace-wide.

What's missing is a single surface that summarizes *all* roadmap items
at once. Right now a reviewer has to either click each item in turn or
read the regression chip and infer the rest. Neither matches the "is
this workspace healthy?" question.

## Workspace dashboard

A new "Workspace" subtab inside the roadmap view (alongside Roadmap /
Requirements / KPIs / etc.). Layout:

```
┌────────────────────────────────────────────────────────────────────┐
│ Workspace KPIs                                          [refresh]  │
│ 12/18 met across 5 projects · 3 regressions · 2 blocked            │
├────────────────────────────────────────────────────────────────────┤
│ Project rollup                                                     │
│ ┌──────────────────────────┬──────┬──────┬──────────────────────┐ │
│ │ roadmap_auth01           │ 4/4  │ met  │ p99, runbook, …      │ │
│ │ roadmap_perf01           │ 2/3  │ ⚠    │ throughput open      │ │
│ │ roadmap_dx01             │ 0/3  │ ⚠    │ all open             │ │
│ │ …                        │      │      │                       │ │
│ └──────────────────────────┴──────┴──────┴──────────────────────┘ │
├────────────────────────────────────────────────────────────────────┤
│ Oldest open KPIs (top 10)                                          │
│ • dx_rating · roadmap_dx01 · open since 2026-04-12 (47 days)       │
│ • throughput · roadmap_perf01 · open since 2026-05-02 (27 days)    │
│ • …                                                                │
├────────────────────────────────────────────────────────────────────┤
│ Recent regressions (last 30 days)                                  │
│ • p99_latency · roadmap_perf01 · 2026-05-26 14:21                  │
│ • …                                                                │
├────────────────────────────────────────────────────────────────────┤
│ Velocity — workspace                                               │
│ [bar chart: KPIs met per day, summed across all items, 30d window] │
└────────────────────────────────────────────────────────────────────┘
```

Three new pure queries (mirroring the C2 module structure), keyed on
the workspace and a list of roadmap item ids:

```ts
// src/workspace/kpi-workspace-history.ts

export interface WorkspaceKpiSummary {
  totalItems: number;
  totalKpis: number;
  metKpis: number;          // counts met OR waived
  regressionCount: number;
  blockedItemIds: string[]; // items where allMet is false
}

export interface OldestOpenEntry {
  roadmapItemId: string;
  kpiId: string;
  openedAt: string;         // first reading_appended (or item creation)
  daysOpen: number;
}

/** Cross-item rollup — fans out to per-item snapshot, sums. */
export function workspaceKpiSummary(
  perItem: readonly { itemId: string; snapshot: KpiSnapshot }[],
  perItemRegressionCount: readonly number[],
): WorkspaceKpiSummary;

/** "Top N stale KPIs" list — sorts by days-open desc. */
export function oldestOpenKpis(
  events: readonly KpiEvent[],
  perItemSnapshots: readonly { itemId: string; snapshot: KpiSnapshot }[],
  limit?: number,
): OldestOpenEntry[];

/** Workspace velocity — sums per-item velocity buckets by day. */
export function workspaceVelocity(
  events: readonly KpiEvent[],
  windowDays: number,
): VelocityBucket[];
```

Rationale for keeping these as pure functions over already-loaded
data: the runtime side already loads the event log once per
`getKpiHistory` call. The workspace dashboard fans out to N items —
loading the file N times wastes a few hundred KB of disk reads. A
single tRPC procedure `getKpiWorkspaceDashboard` reads the events and
state once and runs all three queries.

### tRPC surface

One new procedure:

```ts
runtime.getKpiWorkspaceDashboard()
  → {
      summary: WorkspaceKpiSummary;
      perItem: Array<{ itemId: string; met: number; total: number; blockingIds: string[]; regressionCount: number }>;
      oldestOpen: OldestOpenEntry[];
      recentRegressions: RegressionEntry[];   // last 30 days, all items
      velocity: VelocityBucket[];
    }
```

Inputs are optional `windowDays` (default 30) for velocity / regressions
and an optional `limit` (default 10) for oldest-open.

The procedure derives the list of roadmap item ids from the parsed
ROADMAP.md rather than taking it from the client. That keeps the
dashboard authoritative — if the planner adds a new item, it shows up
without a UI redeploy — and means the dashboard surface doesn't
need to be re-keyed when the board column membership changes.

### UI layout

A new `KpiWorkspacePanel` component renders the layout above. Sections:

- `WorkspaceSummary` — the top stripe with `M/N met · X regressions ·
  Y blocked`. Counts come from `summary`.
- `ProjectRollupTable` — one row per item, showing `met/total`, a
  status pill (all met / some open / blocked), and the first 3
  blocking KPI ids. Clicking an item opens its KPI panel.
- `OldestOpenList` — top 10 oldest-open KPIs, "47 days" style relative
  formatting. Clicking opens the parent item.
- `RecentRegressionsList` — last 30 days, the same shape as the
  per-item regression list reused.
- `WorkspaceVelocityChart` — same `VelocityChart` SVG primitive from
  C2, fed the workspace-wide bucket array.

Empty state: when no roadmap items declare any KPIs, the panel shows a
single hint pointing the planner at `.kanban/kpis/<itemId>.md`. Same
copy as the empty-state in the per-item KPI panel.

Tab placement: under the existing roadmap view header, between
"Timeline" and "Memory". This keeps cross-item analytics visually
adjacent to the timeline (they share a "look across the project" mental
model) and out of any individual item's panel.

## Event log retention

Phase C's design sketched compaction; D codifies it. The trigger is
size-based, not time-based — that's what actually breaks (a 50 MB
JSONL that browsers can't load) versus what's politically charged
(deleting "history").

Three threshold-driven actions (all configurable in `runtime-config`):

| Threshold | Default | Action |
|---|---|---|
| `kpi.events.softLimitBytes`  | 1 MB    | Show a hint in the History tab: "compacting recommended". |
| `kpi.events.compactBytes`    | 4 MB    | Auto-compact on next event append (no user action needed). |
| `kpi.events.hardLimitBytes`  | 16 MB   | Refuse to append; surface a top-bar error chip until the user runs `kanban kpi events compact --force`. |

Compaction algorithm:

1. Find the cutoff ts: events older than `kpi.events.retainDays`
   (default 90) are eligible.
2. Group eligible events by `(scope, day)`. Within each group, keep
   the latest `status_changed` event (the chart's resolution is
   per-day — anything finer is invisible). Drop everything else.
3. Emit a single `chain_compacted` event recording:
   - The byte range and seq range removed.
   - The pre-compaction tail's chainHash (so external auditors
     verifying an older copy of the file still see a valid chain
     ending at that hash).
   - The new starting prevHash.
4. Rewrite the file: kept events with renumbered `seq`, fresh
   `chainHash` chain starting from `chain_compacted`, then the
   un-eligible (recent) events appended on top.

The `chain_compacted` marker is a new event type the verify-chain
walker recognizes. It treats the pre-compaction `chainHash` as the
"genesis-equivalent" prevHash for the entries that follow, instead of
walking past the compaction marker.

This means an audit trail truncated by compaction is **detectable but
not reconstructable** — the chain still verifies (good for "was this
file tampered with?") but the dropped events are gone (their hashes
aren't preserved beyond the marker). That's the right tradeoff for a
gitignored audit file: the audit trail that travels with the repo
already lives in the markdown report files, where compaction is
explicitly disallowed.

### CLI

- `kanban kpi events compact [--dry-run] [--force]`
  - `--dry-run`: print what would be removed; don't write.
  - `--force`: bypass the soft/compact thresholds and run anyway.
  - Defaults: run only when above `compactBytes`; refuse silently
    otherwise so it's safe to wire into a pre-commit hook.

### What does NOT change

- The markdown audit trail (`validation-report.md` `## KPI Readings`
  sections from Phase B branch 3) is **never compacted** — that's the
  durable trail. Compaction only touches the gitignored
  `kpi-events.jsonl`.
- The `verifyKpiEventChain` API is unchanged for callers; internally
  it learns to handle `chain_compacted` markers as chain restart
  points.
- Existing event types and schemas are unchanged. Only the new event
  type and the retention routine itself are new.

## Implementation surface

Three branches, each independently shippable. Same shape Phase B/C
used.

### Branch D1: workspace dashboard query

- `src/workspace/kpi-workspace-history.ts` — three new pure queries:
  `workspaceKpiSummary`, `oldestOpenKpis`, `workspaceVelocity`.
- `getKpiWorkspaceDashboard` tRPC procedure.
- `runtimeKpiWorkspaceDashboard*` schemas in `api-contract.ts`.
- Tests: workspace summary rolls up correctly, oldestOpen sorts by
  age, velocity sums per-item buckets by day, empty workspace
  returns sensible zeros.

### Branch D2: workspace dashboard UI

- `web-ui/src/components/roadmap/kpi-workspace-panel.tsx` — the panel
  component layout above.
- `useKpiWorkspaceDashboard` hook.
- New roadmap-view tab "Workspace" between Timeline and Memory, plus
  the type extension in `roadmap/types.ts`.
- Reuses the existing C2 chart primitives (no new chart code).

### Branch D3: event log retention

- `src/workspace/kpi-event-compaction.ts` — pure compaction algorithm
  (input: existing events, retention config; output: kept events +
  the compaction marker).
- `chain_compacted` event type added to `kpi-event-log.ts`. `verify`
  learns to treat the marker as a chain restart point.
- Auto-compact triggered inside `appendKpiEvents` when the file is
  past `compactBytes`. The lock the appender already holds covers
  the rewrite.
- `kanban kpi events compact` CLI subcommand.
- Top-bar hard-limit chip (mirrors the regression chip pattern;
  red palette).
- Tests: dry-run preserves the file, compact reduces the byte count,
  chain still verifies after compaction, hard limit refuses appends.

## Open questions absorbed during drafting

1. **Should the dashboard live in its own top-level view, or under the
   roadmap-view tabs?** Under the tabs. Reviewers already navigate to
   the roadmap view for project-level work; adding a new top-level
   surface dilutes the roadmap as the project hub.
2. **Per-day or per-week velocity bucketing?** Per-day with a 30-day
   window. Per-week makes the bars bigger but loses the spike pattern
   that's actually useful ("we shipped 4 KPIs Tuesday").
3. **Should compaction recompute hashes for kept events or preserve
   the pre-compaction hashes?** Recompute. Preserving them would mean
   the chain has gaps that the verifier has to work around; a clean
   restart from `chain_compacted` is simpler and the original hashes
   are gone anyway.
4. **What about workspace-wide cycle time?** Out of scope. Cycle time
   is per-KPI by definition; aggregating across KPIs averages away
   the signal. The per-item History tab already shows this when it's
   useful.
5. **Should `getKpiWorkspaceDashboard` accept a roadmap-item-id
   filter (subset)?** No. The whole point of the dashboard is the
   workspace view. Filtering belongs in the per-item History tab,
   which already exists.

## What lands in this branch

Just this document. After review the natural follow-on branches are
the D1/D2/D3 split above.
