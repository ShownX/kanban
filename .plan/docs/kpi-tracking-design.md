# Project KPI tracking design

A design for adding measurable goals to the roadmap so a human reviewer
can answer "is this project done yet?" without reading every deliverable.
The system has two phases that ship in order:

- **Phase B** — structured KPIs on roadmap items, sub-KPIs on tasks, a
  rollup rule, and a review surface for humans. Replaces the prose
  `goal` field with something the runtime can reason about.
- **Phase C** — time-series KPIs. Append every KPI state change to a
  hash-chained event log; render burndown / velocity / time-to-done
  charts.

This doc only commits to Phase B's schema and review surface; it
sketches Phase C and lists what'd need designing once we get there.

## What's already in the codebase

The deliverable-validation work that lives on `feat/roadmap-panel`
already covers a chunk of what a KPI system needs:

- `RuntimeRoadmapItem.goal` (prose) — exit-criteria-as-text
  (`src/core/api-contract.ts:238`).
- `RuntimeRoadmapItem.readiness` — ready/blocked/needs_design/
  needs_requirements (line 225).
- `RuntimeBoardCard.roadmapItemId / specSlug / ownedPaths` —
  per-task linkage to the spec it's implementing.
- Validation report (`workspace/validator.ts`) with structured
  `requirementsCheck`, `scope_compliance`, `experiment_logs`, etc.
  Each requirement has a status (`met` / `partial` / `skipped`) and
  optional evidence text.
- Validation history (`workspace/validation-lifecycle.ts:getTaskValidationHistory`)
  merges roadmap-state.json with the on-disk `## Reviews` section.
- Auto-promote rule
  (`maybeUpdateRoadmapStatus`): a roadmap item flips to `done` once
  every linked task has an `accepted` validation.

So we already have **one** definition of "done": "every linked task has
a clean accepted validation." The KPI system narrows that into "every
linked task has accepted validations *and* every KPI on this item has
been met." The auto-promote rule extends to also gate on KPI status.

## What "KPI" means here

A KPI on a roadmap item is a single, named, measurable piece of the
exit criteria. Each KPI has:

- An `id` and human `label`.
- A `target` — the kind of measurement we're checking, one of:
  - `boolean` — yes/no. Used for "feature exists" / "rolled out" KPIs.
  - `numeric` — `{ kind: "numeric", op: ">=" | "<=" | "==" | "<" | ">", value: number, unit?: string }`.
    Used for latency / cost / coverage / accuracy / count KPIs.
  - `rubric` — `{ kind: "rubric", levels: ["bad","ok","good","great"], minimum: "good" }`.
    Used for qualitative checks where "met" needs human judgment but the
    grades are bounded.
- An `acceptance` policy describing how a measurement becomes a verdict:
  - `manual` — a human reviewer ticks it (default; lowest assumption).
  - `auto-from-task` — meets when at least one linked task records a
    matching sub-KPI measurement (the common case once Phase B lands).
  - `auto-from-validator` — meets when a named validator check
    (e.g. `experiment_logs:perf-baseline.log`) reports a value satisfying
    the target. Reserved for Phase C — needs the validator to emit
    structured measurements, which it doesn't yet.
- A `status: "open" | "met" | "missed" | "waived"`.
  - `open` — no reading yet.
  - `met` — the reading satisfies the target.
  - `missed` — a reading exists and doesn't satisfy the target. Distinct
    from `open` because it forces an explicit waive/reject decision.
  - `waived` — a reviewer accepted that this KPI won't be met for this
    cycle and acknowledged the gap.

A **sub-KPI** is the same shape attached to a task instead of an item.
Sub-KPIs name the slice of the parent KPI that the task is responsible
for. The link is by `parentKpiId`. A task can carry sub-KPIs that don't
roll up to any parent (a sub-KPI without a `parentKpiId` is purely
informational — it's a piece of evidence the task agent is recording
without claiming to satisfy a roadmap KPI).

### Why three target kinds and not just one

A single string-blob target (today's `goal: string`) is what we have.
It puts the burden on the human reviewer to decode each item every
time. A single numeric target would be too narrow: real exit criteria
include "ship the rollback runbook" (boolean) and "team rates DX as
'good' or better" (rubric) alongside "p99 latency under 200ms."

Three kinds is the smallest set that covers the cases without adding
free-form text back in.

## Schema

Adds to `src/core/api-contract.ts`. Backwards-compatible: every new
field is optional, every existing call site keeps working untouched.

```ts
// Target kinds
export const kpiBooleanTargetSchema = z.object({
  kind: z.literal("boolean"),
});

export const kpiNumericOpSchema = z.enum([">=", "<=", "==", "<", ">"]);

export const kpiNumericTargetSchema = z.object({
  kind: z.literal("numeric"),
  op: kpiNumericOpSchema,
  value: z.number(),
  unit: z.string().optional(),
});

export const kpiRubricTargetSchema = z.object({
  kind: z.literal("rubric"),
  levels: z.array(z.string()).min(2),
  minimum: z.string(),
});

export const kpiTargetSchema = z.discriminatedUnion("kind", [
  kpiBooleanTargetSchema,
  kpiNumericTargetSchema,
  kpiRubricTargetSchema,
]);

// Acceptance policy
export const kpiAcceptanceSchema = z.enum([
  "manual",
  "auto-from-task",
  "auto-from-validator",
]);

// Status
export const kpiStatusSchema = z.enum(["open", "met", "missed", "waived"]);

// One reading (a measurement attached to the KPI)
export const kpiReadingSchema = z.object({
  recordedAt: z.string(),                       // ISO-8601
  source: z.enum(["task", "validator", "manual"]),
  // Source-specific keys, all optional. Not all combinations are valid;
  // see acceptance rules below.
  taskId: z.string().optional(),
  validatorCheck: z.string().optional(),
  experimentLog: z.string().optional(),
  // The actual reading. Shape depends on the parent KPI's target kind.
  booleanValue: z.boolean().optional(),
  numericValue: z.number().optional(),
  rubricValue: z.string().optional(),
  // Free-form note from the source ("p99 measured over 10 minutes").
  note: z.string().optional(),
});

// A KPI on a roadmap item
export const projectKpiSchema = z.object({
  id: z.string(),                               // stable, human-readable, kebab-case
  label: z.string(),
  description: z.string().optional(),
  target: kpiTargetSchema,
  acceptance: kpiAcceptanceSchema.default("manual"),
  status: kpiStatusSchema.default("open"),
  // Latest reading is what drives status. History lives below for audit.
  readings: z.array(kpiReadingSchema).default([]),
  // Optional manual override; if present, status reflects this and
  // readings are still kept for audit.
  override: z
    .object({
      status: kpiStatusSchema,
      reason: z.string(),
      reviewer: z.string(),                     // user id (Phase B local; later real user)
      decidedAt: z.string(),
    })
    .optional(),
});

// A sub-KPI on a task. Same target shape, slightly different status set.
export const taskSubKpiSchema = z.object({
  id: z.string(),
  parentKpiId: z.string().optional(),           // links to the project KPI; null = informational only
  label: z.string(),
  description: z.string().optional(),
  target: kpiTargetSchema,
  status: kpiStatusSchema.default("open"),
  readings: z.array(kpiReadingSchema).default([]),
});
```

Two new fields on existing schemas:

- `runtimeRoadmapItemSchema` gains `kpis: z.array(projectKpiSchema).default([])`.
- `runtimeBoardCardSchema` gains `subKpis: z.array(taskSubKpiSchema).default([])`.

The legacy `goal: string` field stays. New format and old format coexist;
the UI prefers `kpis` when non-empty and falls back to the prose
`goal`. Migration is opt-in — operators add KPIs to existing items
when they want measurability; nothing happens automatically.

## How a KPI becomes "met"

Three rules, applied in order:

1. **Override wins.** If `kpi.override` is set, that's the status,
   regardless of readings. This is the escape hatch for human judgment.

2. **Latest matching reading.** Walk `readings` newest-first. Find the
   first reading that's compatible with the target's `kind`
   (boolean reading for boolean target, etc.). If the reading
   satisfies the target, status is `met`; otherwise `missed`.

3. **No readings yet.** Status is `open`.

The `acceptance` field controls **who** can append readings:

- `manual` — only readings with `source: "manual"` count. Reviewer adds
  them through the UI / a CLI command.
- `auto-from-task` — readings with `source: "task"` count. Sub-KPI
  readings on a linked task automatically forward to the parent KPI
  when the task is accepted (see rollup below).
- `auto-from-validator` — readings with `source: "validator"` count.
  Phase C only; validator emits structured measurements.

For `boolean` targets, `met` ↔ `booleanValue === true`.
For `numeric` targets, the reading's `numericValue` is compared via
`target.op` to `target.value`.
For `rubric` targets, the reading's `rubricValue` is checked against
`target.minimum` using the order in `target.levels`.

If a reading's value type doesn't match the target kind, it's ignored
(don't crash; surface a warning in the UI).

## Sub-KPI → KPI rollup

When a task with a sub-KPI is accepted (validation `accepted`):

1. For each sub-KPI on the task with a `parentKpiId`:
   - Find the parent KPI on the linked roadmap item.
   - If the parent's `acceptance === "auto-from-task"`, append the
     sub-KPI's latest reading to the parent's `readings`, tagged
     `source: "task"` with the originating `taskId`.
   - The parent's status is recomputed using the rules above.
2. If the sub-KPI itself has no reading at acceptance time, do nothing —
   the agent didn't measure it, so the parent doesn't pretend it did.
3. If multiple tasks contribute readings to the same parent, the latest
   reading wins for status, but every reading is preserved in
   `readings` for audit.

The auto-promote rule
(`maybeUpdateRoadmapStatus`) becomes:

> Promote item to `done` when every linked task has an `accepted`
> validation **and** every KPI on the item has `status` of `met` or
> `waived`.

Items without any KPIs use the existing rule unchanged.

## Where the data lives

We keep two storage locations, mirroring the existing pattern:

- **Definition** (the structure of KPIs, their targets, etc.):
  - Roadmap KPIs live inside `.kanban/ROADMAP.md` under each item.
    The roadmap-file serializer + parser learn a `### KPIs` section
    per item.
  - Task sub-KPIs live inside `.kanban/specs/<slug>/tasks.md` under
    each task entry, parsed similarly. Falls back to the deliverable
    file's `## Sub-KPIs` section when the spec doesn't carry it.

  Both are human-editable markdown so the planner can keep editing the
  roadmap with whatever tool. No new files.

- **State** (readings, current status, override) lives in the
  gitignored `.kanban/roadmap-state.json` we already use. It gains
  per-item `kpiState: Record<string, KpiState>` and per-task
  `subKpiState: Record<string, KpiState>` maps. The `## Reviews`
  pattern from validation history is the model: durable definition in
  the markdown that travels with git, transient state in the
  gitignored JSON, and a "Reviews-style" `## KPI Readings` section
  optionally appended to `validation-report.md` so the audit trail
  survives a clone.

This gives us:

- The roadmap markdown is still the single committed truth for "what
  KPIs does this project have."
- An offline reviewer can read `ROADMAP.md` and immediately see KPI
  definitions.
- Live status and reading history are backed by the same write-locked
  JSON we already use, so multi-agent updates are safe.

## Validator integration

The validator (`workspace/validator.ts`) gains a seventh check:

`kpi_coverage`:
- For each KPI on the roadmap item with `acceptance: "auto-from-task"`,
  check whether **at least one linked task carries a sub-KPI with a
  matching `parentKpiId` and a non-empty reading.**
- If a KPI has no contributing reading: status `needs_review` with
  message listing the unfunded KPIs.
- If every KPI is covered: `pass`.
- If the item has no KPIs: `pass` (vacuously) — same as today's prose
  goal.

This catches the scariest gap: an agent finishes the work, validation
passes, the auto-promote rule flips the item to done, but the goal
("p99 < 200ms") was never actually measured. The check forces the
absence of measurement to surface as `needs_review`.

## CLI and tRPC surface

New tRPC procedures (workspace-scoped):

- `runtime.computeProjectKpis()` → snapshot per roadmap item:
  `{ itemId, kpis: KpiSnapshot[], allMet, blockingKpis }`.
- `runtime.recordKpiReading({ itemId, kpiId, reading })` — manual
  reading, used by the review UI. Validates that the reading shape
  matches the target kind.
- `runtime.recordSubKpiReading({ taskId, subKpiId, reading })`.
- `runtime.overrideKpi({ itemId, kpiId, status, reason })` —
  reviewer override.

New CLI:

- `kanban kpi status [--item <id>]` — JSON for headless use; same data
  as the tRPC snapshot.
- `kanban kpi record --item <id> --kpi <id> --value <…>` — record a
  manual reading from a script (useful when a CI job measures a perf
  number and wants to feed it back into the KPI).
- `kanban kpi override --item <id> --kpi <id> --status <met|waived> --reason <…>`.

CLI exits non-zero when a KPI is `missed` or `open`-with-no-reading on
a `done`-eligible item, so `kanban kpi status` plugs into a CI gate.

## UI: the review surface

The roadmap view today (`web-ui/src/components/roadmap-tasks-summary.tsx`)
shows a "Live task status" table per item. We add a sibling "KPIs"
panel above it, with one row per KPI:

```
┌────────────────────────────────────────────────────────────────────┐
│ p99 checkout latency       target: ≤ 200ms                MET      │
│   ↳ task t_perf01 measured 178ms · 2026-05-24 14:21               │
│   [history ▾]   [override ▾]                                       │
├────────────────────────────────────────────────────────────────────┤
│ Rollback runbook published target: yes                    OPEN     │
│   No readings yet. Reviewer must tick this manually.               │
│   [mark met]  [mark waived]                                        │
├────────────────────────────────────────────────────────────────────┤
│ Team DX rating              target: rubric ≥ "good"      MISSED   │
│   ↳ manual reading: "ok" · 2026-05-22 09:00                        │
│   [history ▾]   [override ▾]                                       │
└────────────────────────────────────────────────────────────────────┘
   3 KPIs · 1 met · 1 open · 1 missed                  [recompute]
```

A roadmap item can't auto-promote to `done` while any KPI is open or
missed; a banner appears at the top of the panel listing the blocking
KPIs.

The deliverable-validation panel
(`web-ui/src/components/detail-panels/deliverable-validation-panel.tsx`)
gains a "Sub-KPIs" section showing the linked task's sub-KPIs and
whether each has a reading and how the reading rolls up to the parent
KPI. Reviewers can tick sub-KPI readings while approving the
validation.

Per-card badges on the board (in the review column) gain a small
"M/N KPIs" pill alongside the existing validation pill.

The top-bar pending-validations chip extends into a `Reviews queue`
that includes "open KPIs awaiting reviewer attention" alongside
pending validations.

## Phase C — time-series

Once Phase B is in use we get the next layer roughly free.

Every KPI state change (`reading appended`, `override set`,
`status changed`) becomes an entry in a project-level activity log
backed by the existing `src/workspace/activity-log.ts` from the safety
branch (hash-chained, append-only, tamper-evident). The log lives at
`.kanban/kpi-events.jsonl`, gitignored — checked-in audits go through
the markdown file's append-only `## KPI Readings` section.

What it unlocks:

- Burndown chart per roadmap item: `% of KPIs met` over time.
- Velocity: KPIs met per day/week.
- Cycle time: time from `open` → `met` per KPI.
- Time-to-done: time from item-created → all-KPIs-met.
- Regression alert: a KPI that was `met` flipping to `missed` triggers
  a top-bar warning.

Phase C ships once Phase B has a few weeks of real usage. Open
questions from C:

- Retention. The hash-chain is append-only, but the file grows
  forever. Compaction strategy?
- Cross-item dashboards. The current UI is per-item; aggregate views
  (org-wide "% of KPIs met") need a new surface.
- External metric ingest. Wire up Prometheus / Grafana / OpenTelemetry
  exporters for teams that already feed metrics elsewhere.

## Open questions to settle before code starts

1. **Where does the KPI markdown live?** Inside the existing roadmap
   block (one `### KPIs` section per item) or a sidecar
   `.kanban/specs/<slug>/kpis.md`? I lean toward inline-in-roadmap so
   the planner sees KPIs while editing the rest. Risk: the roadmap
   markdown gets longer.
2. **Sub-KPI authoring.** Does the agent declare its own sub-KPIs in
   `tasks.md` / the deliverable, or does the planner declare every
   sub-KPI up front and the agent only fills in readings? Tradeoff
   between agent autonomy and planner control. Recommend: planner
   declares parentKpiId↔subKpiId pairs; agent records readings against
   pre-declared slots.
3. **Numeric target operators.** Five ops (`>= <= == < >`) cover most
   cases. Do we need ranges (`200ms ≤ p99 ≤ 500ms`)? Probably yes
   eventually; can be added as a `between` op without breaking the
   discriminated union.
4. **Override audit.** When a reviewer overrides a `missed` KPI to
   `waived`, where does the reason live? Inline on the KPI (current
   plan) is enough for human review but loses git auditability.
   Should we mirror to validation-report.md the way reviews already
   do? Recommend: yes — same pattern, same code path.
5. **Pre-existing roadmaps.** What's the migration story? An item with
   no KPIs uses today's auto-promote rule, so nothing breaks. The
   onboarding question is "how do we encourage planners to add KPIs?"
   — probably a one-shot prompt nudge in the planner addendum and a
   gentle banner in the UI when an item still has only a prose goal.
6. **Phase B scope cut.** The full doc above is ~2 weeks of work.
   Smallest landable Phase B slice: schema + KPI panel UI + manual
   reading + the new `kpi_coverage` validator check, no CLI, no
   sub-KPI rollup. ~1 week. Worth doing as a staging branch before
   we commit to the rest.

## What lands in this branch (`feat/kpi-tracking-design`)

Just this document. No code. After review, the natural follow-on
branches:

1. `feat/kpi-schema-and-validator` — Phase B schema + the
   `kpi_coverage` validator check. Default-empty `kpis` arrays so
   existing roadmaps are untouched.
2. `feat/kpi-review-ui` — the KPI panel in the roadmap view + the
   sub-KPI section in the deliverable panel.
3. `feat/kpi-cli-and-rollup` — CLI commands + sub-KPI auto-rollup +
   override flow + audit trail in `validation-report.md`.
4. `feat/kpi-events-and-charts` — Phase C; gets its own design doc
   when we get there.
