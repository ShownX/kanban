# Project KPI tracking — Phase C design

Phase B (`feat/roadmap-panel`) shipped the structured KPI surface:
schema, validator check, snapshot helper, CLI, tRPC, review UI panel,
sub-KPI rollup on accept, auto-promote gating. What it doesn't have is
**time** — the snapshot answers "is this KPI met *right now*?" but
not "how is this KPI trending?", "how long does it take a typical KPI
to go from open to met?", or "which KPI flipped from met back to
missed last week?".

This document covers Phase C: a tamper-evident event log of every KPI
state change, plus the small set of charts and alerts that log enables.
It explicitly defers the parts of the original Phase B sketch that
needed Phase C to land first — most notably `auto-from-validator` KPIs.

This is a design-only commit. Implementation lands on follow-on
branches once the design has been reviewed.

## What lives on top of Phase B

Phase B already gives us:

- A locked-JSON state file (`.kanban/kpi-state.json`) with every
  reading and override.
- A snapshot helper (`buildKpiSnapshot`) that resolves definition +
  state into evaluated status.
- An auto-promote rule that gates on `snapshot.allMet`.
- Review UI + CLI that mutate state through tested helpers.

What's missing is the *history of changes*. Every reading append
produces a new state, but yesterday's state is forgotten as soon as a
new reading lands. We can recover individual readings (they're
preserved in `kpi.readings`) but not the *sequence of evaluated
statuses* — which is the data shape charts need.

## Event log format

A new file:

  `.kanban/kpi-events.jsonl`

Append-only, gitignored (the audit trail that travels with the repo
already lives in the markdown report files). One JSON object per line,
written through `lockedFileSystem` so concurrent agents can't
interleave a half-line.

```ts
export const kpiEventTypeSchema = z.enum([
  "reading_appended",
  "override_set",
  "override_cleared",
  "status_changed",
]);

export const kpiEventSchema = z.object({
  /** Monotonic sequence number, starts at 1, gap-free per file. */
  seq: z.number().int().positive(),
  ts: z.string(),                        // ISO-8601, when the event was recorded
  type: kpiEventTypeSchema,
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project"), itemId: z.string(), kpiId: z.string() }),
    z.object({ kind: z.literal("task"), taskId: z.string(), subKpiId: z.string() }),
  ]),
  /** Only present for reading_appended; mirrors the appended reading. */
  reading: kpiReadingSchema.optional(),
  /** Only present for override_set. */
  override: kpiOverrideSchema.optional(),
  /** Only present for status_changed; the resolved status before/after this event. */
  statusFrom: kpiStatusSchema.optional(),
  statusTo: kpiStatusSchema.optional(),
  /** Hash of the previous event's `chainHash` (or "0" for seq=1). */
  prevHash: z.string(),
  /** SHA-256 of the previous chainHash + the canonical JSON of this entry without `chainHash`. */
  chainHash: z.string(),
});
```

`prevHash`/`chainHash` form a tamper-evident chain: any insertion or
edit invalidates the chain from that point forward, and a verifier
running against the file detects it. Storage is gitignored, but the
chain still helps catch corruption / accidental hand-edits in the
local copy.

### Why a chain at all when the file is gitignored

The chain isn't for proving authorship. It's for catching:

- An agent that crashed mid-write and produced a torn line.
- A user who hand-edited the file and broke a sequence.
- A future "compact old events" routine that swaps a range of entries
  out and forgets to fix prevHash on the first surviving entry.

A simple `kanban kpi events verify` CLI command walks the chain and
returns the line number of the first break, if any.

## When events get emitted

Phase B already mutates state through three call sites:

- `appendKpiReading` (project KPI) and `appendSubKpiReading` (task
  sub-KPI) — both in `kpi-state-file.ts`.
- `setKpiOverride` / `clearKpiOverride` — same module.
- `rollUpSubKpisOnAccept` — wraps `appendKpiReading` per parent KPI.

Phase C wraps each of those with an event emit:

1. **Read the prior status** of the affected KPI (via
   `evaluateProjectKpi` / `evaluateTaskSubKpi`) before applying the
   mutation.
2. **Apply the mutation** as Phase B does.
3. **Read the new status**.
4. **Emit two events** when status changed: a `reading_appended` /
   `override_set` event, and a `status_changed` event with
   `statusFrom` and `statusTo`. When the mutation didn't change the
   status (e.g. a second reading that confirms the existing status),
   only the first event is emitted.

This is the smallest pattern that gives charts everything they need:
the exact reading/override that caused each transition, plus the
explicit transition record.

To keep call sites clean, the wrap lives in a tiny `kpi-event-recorder`
module that takes a workspace path + the mutation closure. The current
`appendKpiReading` etc. become thin shims that call the recorder.

## Reusing existing infrastructure

The original Phase B sketch said "use `activity-log.ts` from the safety
branch (hash-chained, append-only, tamper-evident)". That module was
never merged into `feat/roadmap-panel`. The closest neighbor is
`src/workspace/shared-memory.ts`, which has an append-only JSONL but
no hash chain.

**Decision:** build a small dedicated `kpi-event-log.ts` rather than
extending shared-memory. Two reasons:

1. The shared-memory event schema is open-ended (`event: enum(...)`
   with optional fields) and would either need a new variant or
   awkward overloading to fit KPI-specific fields like `prevHash` /
   `statusFrom`.
2. Keeping KPI events in their own file means the verify-chain CLI is
   a single-purpose pass; mixing it with shared-memory events would
   force it to skip non-KPI lines and reason about which ones are part
   of the chain.

The new module shares a small `hashLine(prevHash, payload)` helper
with anything else that ever wants a chain (auth audit, project-level
activity), placed under `src/workspace/hash-chain.ts`. That keeps
crypto in one tested spot.

## Phase C implementation surface

Three branches, each independently shippable, each with tests. Same
pattern Phase B used.

### Branch C1: event log + status-change emission

- `src/workspace/hash-chain.ts` — pure helper.
- `src/workspace/kpi-event-log.ts` — append + read + verify, locked.
- Wrap the four state-mutation entry points. Tests cover: chain
  integrity, `status_changed` emitted only on actual transitions,
  rollup-on-accept emits the transition for the parent (not just the
  reading append), torn-line / out-of-order detection.
- New `kanban kpi events verify` and `kanban kpi events list
  [--since <iso>] [--item <id>]` CLI commands.

### Branch C2: time-series queries + chart components

- `src/workspace/kpi-history.ts` — pure functions over the event log:
  - `kpiBurndown(events, itemId)` → `[{ ts, totalKpis, metKpis }]`.
  - `kpiVelocity(events, itemId, window)` → KPIs met per day/week.
  - `kpiCycleTime(events, itemId)` → time from first reading to first
    `met`, per KPI.
  - `kpiRegressions(events, itemId)` → events where status flipped
    from `met` back to `missed`.
- New tRPC procedure `getKpiHistory` (returns the raw events filtered
  by item/since; charts render client-side).
- Web-UI: a "History" subtab inside the KPI panel renders three small
  charts (recharts is already a dependency). Empty-state copy when
  the event log has fewer than 3 transitions — the charts need
  trajectory, not a single point.

### Branch C3: regression alerts + auto-from-validator

Two pieces that share the trigger surface ("a status_changed event
landed").

- **Regression alerts.** A `RegressionWatcher` runs on every event
  append; when it sees a `status_changed` with `statusFrom: "met"` and
  `statusTo: "missed"`, it raises a top-bar warning chip. Persists
  the dismissed/acknowledged state in `roadmap-state.json`. Same
  pattern the pending-validations chip already uses.
- **`auto-from-validator` KPIs.** Phase B explicitly defers these.
  Phase C ships them: when a validation report's `experiment_logs`
  check produces a structured measurement (per a per-check
  measurement extractor that lives next to the existing experiment-log
  parser), the validator emits a `reading_appended` event with
  `source: "validator"`. The existing engine + snapshot already handle
  the rest — we just needed a pipe from validator output to KPI
  reading.

## Retention

The event log grows ~1 KB per state change (rough envelope: 200 byte
JSON × 5x for serialization overhead). Worst case for an active
project with weekly KPI updates over a year: a few hundred KB. We
don't compact in Phase C.

If the file ever needs trimming, the rule is:

- Keep the most recent N days' events verbatim.
- For older events, keep one `status_changed` per KPI per day (the
  burndown chart's resolution is a day; nothing finer is consumed).
- Drop `reading_appended` / `override_set` for older windows since
  those are recoverable from `kpi-state.json` if needed.

Compaction itself produces a `chain_compacted` event that records the
truncated range and the new starting `prevHash`. Verify-chain
recognizes that marker. This is sketched here for completeness; the
implementation can wait until a real project hits ~10 MB.

## Cross-item dashboards

Out of scope for Phase C. The per-item History tab is enough for the
"is this project healthy" question. Workspace-wide rollups (% of all
KPIs met, list of all regressions across the workspace) are a Phase D
concern when there's a real example of someone needing them.

## External metric ingest

Out of scope for Phase C. The pattern is that CI numbers come in as
manual readings with a CI URL pasted into `note` (Phase B already
supports this via `kanban kpi record --note "<url>"`). A first-class
Prometheus / Grafana / OpenTelemetry exporter waits for someone with a
real ingest target — the schema work would all be in the exporter,
not the core.

## What does NOT change in Phase C

To keep scope crisp:

- No retention enforcement (the compaction sketch above is
  documentation, not code).
- No alerting beyond the in-app top-bar chip — no email, no Slack
  webhooks, no PagerDuty.
- No per-team or per-org partitioning. The event log is per-workspace,
  same scope as the snapshot.
- No editing of historical events. The log is append-only; corrections
  go in by appending a new event with the corrected reading and a
  `note` explaining the correction.
- No public API. Everything is workspace-scoped, same as Phase B.

## Open questions absorbed during Phase C drafting

These came up while writing this document and were resolved inline,
listed here for the reviewer:

1. **Do we need the chain if the file is gitignored?** Yes — see "Why
   a chain at all" above. The chain is for corruption detection, not
   authorship.
2. **One event per mutation, or two (mutation + status change)?** Two,
   because charts need the explicit transition and dropping the
   mutation event would lose the *cause* of each transition.
3. **Do override-cleared events need their own type?** Yes — losing
   an override can flip a KPI from `waived` back to `open`. Modeling
   it as `override_set` with `override: undefined` would be confusing.
4. **Do task sub-KPI events need their own scope variant?** Yes — the
   chart layer does want them (cycle time at the sub-KPI level is
   meaningful), and folding them under "project" would force every
   query to filter on `kpiId === sub-KPI-id` shapes. Better to split
   the discriminator at the source.
5. **Can we reuse `shared-memory.ts`?** No — see "Reusing existing
   infrastructure" above.

## What lands in this branch

Just this document (mirroring how the Phase B design landed alone on
`feat/kpi-tracking-design`). After review, the natural follow-on
branches are the C1 / C2 / C3 split listed above.
