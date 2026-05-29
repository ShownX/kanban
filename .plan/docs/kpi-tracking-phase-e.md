# Project KPI tracking — Phase E design

Phase B + C + D shipped the in-app KPI surface end-to-end: schema,
event log, history charts, workspace dashboard, retention. What's
still missing — and the smallest credible step toward "metrics
infrastructure outside Kanban" — is an exporter. This document covers
Phase E: a **Prometheus textfile-collector exporter** that writes
`.prom` files Kanban already has the data for, leaving Kanban itself
network-free.

The textfile collector is the lowest-commitment external target:
- No daemon to run, no port to open, no auth to manage.
- Anyone with Prometheus already runs `node_exporter`, and the
  textfile collector is enabled by default in most setups.
- The output is plain text — even teams without Prometheus can `cat`
  the file for ad-hoc inspection or pipe it into custom tooling.

Phase E does **not** include a push-gateway client, a remote-write
sink, or any HTTP server inside Kanban. Those wait for a user with a
concrete pull-mode-impossible target. The schema work for those would
be in the network protocol shim, not the metric definitions, so the
metric layout we ship now stays useful.

## What lives on top of Phase D

Phase D already gives us:

- A workspace-wide rollup (`getKpiWorkspaceDashboard`) that returns
  every number the exporter needs.
- A snapshot helper (`buildKpiSnapshot`) that cheaply resolves any
  single item.
- The hash-chained event log + retention (so we don't blow up the
  file when an exporter scrapes it).

What's missing is the **transformation** from those JSON shapes into
the Prometheus exposition format, plus a write loop with sensible
freshness semantics.

## Output file location

  `.kanban/kpi-metrics.prom`

Gitignored, mirrors `kpi-events.jsonl` and `kpi-state.json`. Mirroring
the same directory keeps the "if you want to sync KPI state somewhere,
sync the .kanban dir" mental model consistent.

For Prometheus integration, the user (not Kanban) is responsible for
creating a symlink from the textfile collector dir to this file:

```
ln -s /path/to/repo/.kanban/kpi-metrics.prom /var/lib/node_exporter/textfile/kanban-kpi.prom
```

We deliberately don't try to write into a system path. Kanban runs in
the user's repo; symlinking is one shell command, and it keeps Kanban
out of root-owned filesystem trees.

## Metric schema

Five metrics. All carry a `workspace` label set to the workspace name
(directory basename, sanitized) so multi-repo Prometheus scrapes can
distinguish them.

### `kanban_kpi_status` (gauge)

Per-KPI status as a numeric code. Labels: `workspace`, `roadmap_item`,
`kpi_id`, `acceptance`.

Values:

| Code | Status |
|---|---|
| 0 | open |
| 1 | met |
| 2 | missed |
| 3 | waived |

```
# HELP kanban_kpi_status Status of each project KPI (0=open 1=met 2=missed 3=waived).
# TYPE kanban_kpi_status gauge
kanban_kpi_status{workspace="kanban",roadmap_item="roadmap_perf01",kpi_id="p99_latency",acceptance="auto-from-task"} 1
```

A status enum encoded as a number is the standard
Prometheus pattern (cf. `kube_pod_status_phase`). Charting tools can
filter to `status_code == 1` for "met" panels.

### `kanban_kpi_value` (gauge)

The aggregated numeric value for KPIs whose target kind is `numeric`.
Labels match `kanban_kpi_status` plus `unit`. Boolean and rubric KPIs
don't get a `_value` row — they have no meaningful scalar.

```
# HELP kanban_kpi_value Aggregated value of numeric KPIs.
# TYPE kanban_kpi_value gauge
kanban_kpi_value{workspace="kanban",roadmap_item="roadmap_perf01",kpi_id="p99_latency",acceptance="auto-from-task",unit="ms"} 178
```

### `kanban_kpi_readings_total` (counter)

Total readings appended per KPI since the log started. Labels match
`kanban_kpi_status` plus `source`. Counters give us rate() in PromQL
for "readings per minute" alerting if anyone wants it.

### `kanban_kpi_workspace_summary` (gauge family)

The workspace dashboard summary, exposed as four named gauges so each
is its own one-row series:

```
kanban_kpi_workspace_total{workspace="kanban"} 18
kanban_kpi_workspace_met{workspace="kanban"} 12
kanban_kpi_workspace_blocked_items{workspace="kanban"} 2
kanban_kpi_workspace_regressions{workspace="kanban"} 3
```

This deviates from a single gauge with `kind="met|total"` labels
because Prometheus's idiomatic shape is "one metric name per concept,
labels for slicing." Splitting them keeps PromQL simple
(`100 * met / total`).

### `kanban_kpi_oldest_open_days` (gauge)

For every currently-open KPI, days-open since the first reading.
Labels match `kanban_kpi_status` minus `acceptance` (which doesn't
matter for staleness). Capped at the dashboard's top-N (default 50)
to keep cardinality bounded.

```
kanban_kpi_oldest_open_days{workspace="kanban",roadmap_item="roadmap_dx01",kpi_id="dx_rating"} 47
```

### Why no per-day velocity / per-day burndown metric?

PromQL already does these via `rate()` and `count()` on
`kanban_kpi_status`. Re-exposing per-day buckets would mean carrying
the same data twice in different shapes, and the per-day buckets
would have an unbounded label cardinality (`day="2026-04-15"` ×
many). The per-second status gauge plus `rate(kanban_kpi_readings_total[1h])`
covers the same questions without the cardinality blow-up.

## Transformation

A new pure module, `src/workspace/kpi-prometheus-format.ts`:

```ts
export interface PrometheusFormatInput {
  workspace: string;        // sanitized workspace name
  perItem: Array<{
    itemId: string;
    snapshot: KpiSnapshot;
    readingCounts: Map<string, number>;  // kpiId -> total reading events
  }>;
  workspaceSummary: WorkspaceKpiSummary;
  oldestOpen: OldestOpenEntry[];
}

export function formatPrometheusMetrics(input: PrometheusFormatInput): string;
```

Pure function. Takes the same inputs the workspace dashboard
already builds; emits the `.prom` text. Tests verify HELP/TYPE
header presence, label escaping, status code mapping, deterministic
metric order (sort keys are `(metric, label set)` ascending) so a
no-change export produces a byte-identical file. The deterministic
order is what makes "did anything change since last write" a
single-line check.

## Write strategy

Two callers, one writer:

- **CLI**: `kanban kpi export prometheus [--output <path>] [--watch]`.
  - One-shot mode (default): read state, format, write, exit.
  - `--watch`: refresh every `intervalSeconds` (default 60).
  - `--output`: override the default `.kanban/kpi-metrics.prom`.
- **Runtime auto-export** (off by default): when
  `runtime.kpi.exportPrometheus.enabled` is `true` in
  `runtime-config.json`, the runtime starts the same write loop as
  `--watch` while it's running. Stops on shutdown.

Both call into a shared `writeKpiPrometheusMetrics(workspaceRoot,
opts)` helper. Atomic write (temp + rename) so a Prometheus scrape
mid-update never sees a torn file. Unchanged-output detection skips
the rename when the formatted text is byte-identical to what's
already on disk.

The default refresh interval is **deliberately coarse** (60s). KPIs
don't change at the rate metrics infrastructure can scrape; pushing
the cadence lower wastes CPU without buying signal. Users can override
via the config knob.

## CLI

```
kanban kpi export prometheus [options]
```

Options:

- `--output <path>` — Override default location.
- `--watch` — Run as a refresh loop.
- `--interval <seconds>` — Refresh interval (default 60). Implies
  `--watch`.
- `--workspace <path>` — Workspace root (defaults to cwd, same as
  the rest of the `kanban kpi *` commands).

One-shot mode exits 0 on success, 1 on any error. `--watch` only
exits on signal.

## Implementation surface

Single branch (smaller than D's three; the work is mostly format +
plumbing). Same shape as Phase B/C/D.

### Branch E1: Prometheus exporter

- `src/workspace/kpi-prometheus-format.ts` — pure transformation +
  metric helpers (label escaping, value rendering, deterministic
  sort).
- `src/workspace/kpi-prometheus-writer.ts` — thin IO wrapper:
  builds the input by reading events + state + roadmap, calls the
  format function, atomic-writes the result, optionally idle-detects
  no-change.
- `src/commands/kpi.ts` — `export prometheus` subcommand. Watch
  mode handled with a simple `setInterval` loop + SIGINT handler.
- `src/config/runtime-config.ts` — new optional knob
  `kpi.exportPrometheus = { enabled: false, intervalSeconds: 60,
  outputPath?: string }`.
- Runtime hook: when the config knob is true, start the write loop
  alongside the existing runtime-state-stream. Reuses the existing
  graceful-shutdown registration so `Ctrl-C` cleans up.

Tests:

- `kpi-prometheus-format.test.ts` — golden-file style; a few small
  `PrometheusFormatInput` fixtures produce expected text. Includes:
  - Empty workspace yields just the workspace summary stanzas with
    zeros (no per-KPI rows).
  - Boolean/rubric KPIs omit `kanban_kpi_value` rows.
  - Label values with `\` and `"` are escaped.
  - Multi-item input sorts deterministically.
  - Override-waived KPI surfaces as status code 3.
- `kpi-prometheus-writer.test.ts` — end-to-end through a temp
  workspace: events + state seeded → write → assert file content +
  rerun produces byte-identical output.

## Open questions absorbed during drafting

1. **Push gateway vs textfile?** Textfile. Push gateway is for
   short-lived jobs that won't be alive when Prometheus scrapes;
   Kanban metrics are workspace-state, not job-state. Textfile
   matches the lifetime model.
2. **Histograms for KPI values?** No. KPIs are workspace-state
   gauges, not request latencies. A histogram would expose the
   distribution of values *across KPIs*, which isn't a meaningful
   axis to alert on.
3. **Should the workspace label be configurable?** Default to
   sanitized basename of the workspace path. Override available via
   `runtime-config` (`kpi.exportPrometheus.workspaceLabel`) for
   teams that want a different naming convention.
4. **Should we expose validation report counters too?** Out of scope.
   Phase E is KPI-specific; validation counters would be a separate
   exporter once a user asks. Keeping them separate also keeps the
   metric namespace narrow and easy to reason about.
5. **Atomic write semantics — same temp+rename as
   `lockedFileSystem.writeTextFileAtomic`?** Yes. Reuse the same
   helper Phase B/C/D already use; gives us crash-safety + lock
   semantics for free.

## What does NOT change

- No HTTP server inside Kanban.
- No push-gateway / remote-write client.
- No new dependencies. The format module emits plain strings; the
  writer reuses `lockedFileSystem`.
- No retention on the metrics file (it's overwritten in full each
  refresh, so it can't grow).

## What lands in this branch

Just this document. The natural follow-on branch is the single E1
implementation listed above.
