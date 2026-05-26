# KPI design — paper trace against the deliverable-validation feature

A worked example that walks `kpi-tracking-design.md` against a real,
recently-completed roadmap-scale piece of work. The point is to find
where the design is too loose, too tight, or just wrong, before any
code lands.

The example: the **deliverable-validation** feature shipped on
`feat/roadmap-panel`. We know what actually mattered, what landed,
and what got cut, so we can rate the design with hindsight rather
than imagination.

## Step 1 — what was the goal, in retrospect

If we'd been writing this as a roadmap item up front, the exit
criteria would have looked roughly like:

1. Reviewers can accept / reject / escalate a deliverable from the
   web UI in under 30 seconds, including writing a reject reason.
2. The validator scores deliverables against six checks (requirements,
   scope, interface, spec staleness, changelog, experiment logs).
3. Auto-validate runs when a card lands in review (manual move or
   agent transition) and is configurable per workspace.
4. Review history (outcome, reviewer note, timestamp) survives a
   fresh `git clone` of the workspace.
5. Per-card validation badge on the board so reviewers can triage at a
   glance without opening the panel.
6. Test coverage: every parser, file reader, and lifecycle helper has
   a unit test; the panel data hook has a render test; the validator
   has integration tests.
7. Single-user mode is unaffected — no behavior change when no
   workspace opts in.
8. CLI parity for headless workflows: `kanban task validate --task-id`.

Eight criteria. Some are crisp ("under 30 seconds"), some are fuzzy
("survives a clone"), some are binary ("CLI command exists"). Real
exit criteria look like this — a mix of measurable, observable, and
just-needs-to-exist.

## Step 2 — express each as a KPI

Schema fit is the first thing I want to test. Each criterion gets
slotted into one of the three target kinds.

| # | Criterion | Target kind | Acceptance | Notes |
|---|---|---|---|---|
| 1 | Review action under 30s | `numeric` `<=`, value: 30, unit: "s" | manual | Hard to auto-measure without an instrumented timer; reviewer eyeballs it. |
| 2 | Six checks score the deliverable | `numeric` `==`, value: 6 | auto-from-validator | Validator already produces six structured checks; just count them. |
| 3 | Auto-validate runs on review-column entry | `boolean` | auto-from-task | Specific task ("auto-validate plumbing") writes the proof reading. |
| 4 | Review history survives `git clone` | `boolean` | manual | Has to be tested by a human cloning into a tmp dir. |
| 5 | Per-card validation badge on board | `boolean` | auto-from-task | Task that adds the badge writes the reading. |
| 6 | Tests for parsers + readers + lifecycle | `numeric` `>=`, value: 80, unit: "%" | auto-from-validator | Coverage % from CI; ties into Phase C metric ingest. |
| 7 | Single-user mode unchanged | `boolean` | manual | "I tried single-user mode and nothing broke." |
| 8 | CLI parity | `boolean` | auto-from-task | Task implements the CLI; reading set when accepted. |

**Findings from this step:**

- Three target kinds covered all eight. No criterion needed a fourth
  kind. ✓ Schema fits.
- The mix of acceptance policies is roughly half manual, half auto.
  That validates having all three policies; if it'd been 8/8 manual
  the auto-* plumbing in the design would be over-engineered. ✓
- KPI #1 ("under 30s") highlights a soft spot: how do you take a
  numeric measurement of an end-to-end UX time without instrumenting
  the UI? In practice the reviewer either eyeballs it
  (`source: "manual"`) or runs a one-shot test and pastes the number
  in. Neither requires schema work — just a CLI ergonomics question.
  See open question 7 below.
- KPI #6 ("80% test coverage") wants a value that comes from CI, not
  from a task or a validator. The design assumes readings come from
  validator/task/manual; CI is a fourth source. **This is a gap.**
  See open question 8 below.

## Step 3 — slot in sub-KPIs

The design says: "planner declares parentKpiId↔subKpiId pairs; agent
records readings against pre-declared slots." Let's test that.

Take KPI #2 ("six structured checks"). The implementation work was
spread across several tasks:

- t_validator01 — implement validator + first 5 checks
- t_validator02 — add `experiment_logs` check (the 6th)
- t_panel01 — render check results in the panel

Sub-KPIs the planner would declare:

- t_validator01.subkpi[checks_implemented]: numeric, parent =
  item.kpi[six_checks], target == 5
- t_validator02.subkpi[checks_implemented]: numeric, parent =
  item.kpi[six_checks], target == 1

Rollup: when both tasks are accepted, the parent KPI sums the
readings? **Wait — the design doesn't say sum.** It says "the latest
reading wins." For KPI #2, latest-wins is wrong; we want sum (5 + 1 = 6).

**This is a gap.** The rollup rule needs an aggregation policy
(`latest` / `sum` / `min` / `max` / `all-must-meet`). Default `latest`
is fine for `boolean` and most `numeric` cases; `sum` is needed for
"count of things implemented across multiple tasks." See open question
9 below.

## Step 4 — walk the validator integration

The new `kpi_coverage` check fires on validation. Trace it for our
example:

- Run validator on t_validator02 once it lands.
- For each KPI on the parent roadmap item with `acceptance: "auto-from-task"`,
  is there a linked task with a sub-KPI carrying a reading?
- KPI #3 (boolean, auto-from-task): t_autovalidate has a sub-KPI with
  a `booleanValue: true` reading. ✓ covered.
- KPI #5 (boolean, auto-from-task): t_card-badge has a sub-KPI with a
  reading. ✓ covered.
- KPI #8 (CLI parity): t_cli has a sub-KPI with a reading. ✓ covered.
- KPI #2: covered by t_validator01 + t_validator02 sub-KPIs (assuming
  the rollup gap from Step 3 is fixed). ✓
- KPI #1, #4, #7: `acceptance: "manual"` — the `kpi_coverage` check
  doesn't try to enforce these.
- KPI #6: `acceptance: "auto-from-validator"` — Phase C; we'd skip in
  Phase B and the check would either ignore it or flag it as
  "blocked on Phase C." Probably ignore + show as `open`.

**Finding**: the `kpi_coverage` check works for the auto-from-task
KPIs. For `auto-from-validator` KPIs in Phase B, we need to decide
whether the check ignores them or marks them as needing review. I'd
say ignore (status stays `open`); a separate UI signal points out
"this KPI is waiting on Phase C." Doc currently says "ignored or
flag" without committing — let's commit. See open question 10.

## Step 5 — walk the auto-promote rule

> Promote item to `done` when every linked task has an `accepted`
> validation **and** every KPI on the item has `status` of `met` or
> `waived`.

For our example, every task accepted means: t_validator01,
t_validator02, t_panel01, t_autovalidate, t_card-badge, t_cli, etc.
are all green. The KPI list:

- KPI #1 — manual; reviewer ticked it `met` after watching themselves
  do an accept in 18s. ✓
- KPI #2 — auto-from-task; sub-KPI rollup (once Step 3's gap is
  fixed) gives `met`. ✓
- KPI #3 — auto-from-task, `met`. ✓
- KPI #4 — manual, reviewer cloned into a tmpdir, history present,
  `met`. ✓
- KPI #5 — auto-from-task, `met`. ✓
- KPI #6 — auto-from-validator, **`open` in Phase B**. Auto-promote
  blocked by an `open` KPI.
- KPI #7 — manual, reviewer ran single-user mode, no diff, `met`. ✓
- KPI #8 — auto-from-task, `met`. ✓

**Finding**: the rollup correctly gates done on KPI #6 still being
`open`. The reviewer's escape hatch is to `waive` it: "Phase C ships
later; we know coverage is at 78% today and that's acceptable for
v1." That seems right — KPI #6 stays as a known shortfall the team
made an explicit decision about, not a silent miss.

What if the reviewer wants to ship today *anyway* because they're
under deadline pressure and KPI #6 is genuinely a stretch goal?
The `waive` flow handles this. The audit trail (Phase B: in
roadmap-state.json + appended to validation-report.md) carries the
reason. ✓ Design holds.

## Step 6 — walk the review surface

The mock in the design doc shows three rows. Let's mock our example
and see if it scales to 8 KPIs.

```
┌────────────────────────────────────────────────────────────────────┐
│ Reviewer can accept/reject in <30s     target: ≤30s        MET    │
│   ↳ manual: 18s · 2026-05-24 14:21                                │
├────────────────────────────────────────────────────────────────────┤
│ Six structured validator checks         target: ==6        MET    │
│   ↳ task t_validator01: 5 checks · 2026-05-22 10:00              │
│   ↳ task t_validator02: 1 check  · 2026-05-23 11:00              │
├────────────────────────────────────────────────────────────────────┤
│ Auto-validate on review entry           target: yes        MET    │
│   ↳ task t_autovalidate · 2026-05-22 16:00                        │
├────────────────────────────────────────────────────────────────────┤
│ Review history survives clone           target: yes        MET    │
│   ↳ manual: tmpdir clone shows ## Reviews · 2026-05-24 09:00     │
├────────────────────────────────────────────────────────────────────┤
│ Per-card validation badge               target: yes        MET    │
│   ↳ task t_card-badge · 2026-05-22 12:00                          │
├────────────────────────────────────────────────────────────────────┤
│ Test coverage on parsers/readers        target: ≥80%       OPEN   │
│   No readings yet. Phase C metric ingest needed.                  │
│   [mark waived]                                                   │
├────────────────────────────────────────────────────────────────────┤
│ Single-user mode unchanged              target: yes        MET    │
│   ↳ manual: smoke-tested · 2026-05-24 13:00                       │
├────────────────────────────────────────────────────────────────────┤
│ CLI parity                              target: yes        MET    │
│   ↳ task t_cli · 2026-05-23 14:00                                 │
└────────────────────────────────────────────────────────────────────┘
   8 KPIs · 7 met · 1 open · 0 missed · 0 waived       [recompute]
   1 KPI blocking auto-promote: "Test coverage on parsers/readers"
```

**Findings:**

- 8 rows is fine. Scrolls. No layout issue.
- The "blocking" banner at the bottom is necessary — counting 7/8
  green isn't enough; the reviewer needs to know **which** KPI is
  blocking. Doc has this. ✓
- Each row needs a click-target for "show readings history." The
  mock has `[history ▾]`. Should we also show the reading inline? My
  read: yes for the latest, with `[history ▾]` for older ones. Doc
  shows latest inline. ✓
- The override action is on the row. For a `met` KPI, override is
  rare but possible (override to `missed`?). Probably yes for
  symmetry; rare enough that we can just hide it behind the kebab.

## Step 7 — sub-KPIs in the deliverable-validation panel

The design says the panel grows a "Sub-KPIs" section. For
t_validator02 (the experiment_logs check task):

```
┌──────────── Sub-KPIs ────────────┐
│ Checks implemented (numeric)     │
│   target: == 1                   │
│   reading: 1 · met               │
│   parent KPI: six_checks (item)  │
└──────────────────────────────────┘
```

A reviewer accepting the validation can also tick this sub-KPI
reading at the same time. Latency-wise that's fine — the existing
panel already collects review notes; one more action is acceptable.

**Finding**: the deliverable-validation panel was designed assuming
"validation = accept/reject one report." Adding sub-KPI confirmation
makes the accept gesture multi-step. We need to decide: is sub-KPI
confirmation **required** before accepting validation, or is it a
separate action the reviewer does later? If required, the panel's
Accept button becomes a wizard. If separate, it's two trips back
to the card.

Doc currently says "ticking sub-KPI readings while approving" — i.e.
combined. I'd push back on that and prefer **separate**: sub-KPI
readings are evidence the agent provides at deliverable-write time,
not something the reviewer enters. The reviewer just confirms the
reading is plausible. Open question 11 below.

## Step 8 — open questions, marked up

The design doc lists 6 open questions; this trace adds 5 more. Here
are answers I'd commit to based on the trace:

| # | Question (from design doc) | My answer after the trace |
|---|---|---|
| 1 | Where does the KPI markdown live? | Inline in roadmap. Trace showed an item with 8 KPIs is still readable; sidecar would scatter context. Keep `## Comments` and `### KPIs` adjacent so the planner edits both at once. |
| 2 | Sub-KPI authoring (planner vs agent)? | Planner declares `parentKpiId ↔ subKpiId` pairs in `tasks.md`; agent fills in readings via the deliverable. Open question 11 below sharpens this further. |
| 3 | Numeric ranges? | Not in Phase B. Add `between` op when a real example needs it. |
| 4 | Override audit trail? | Mirror to `validation-report.md` `## KPI Overrides` section. Same pattern as `## Reviews`. |
| 5 | Migration story for prose-only goals? | Roadmap items with no `kpis: []` keep working with the existing rule. Banner: "This item has a prose goal but no measurable KPIs — consider adding one for clarity." |
| 6 | Smallest landable Phase B slice? | After this trace I'd actually argue for the **wider** Phase B — the rollup gap (#9 below) and the manual-vs-auto-from-task split (#11) are both load-bearing for the review surface to work. ~10 days of focused work, not the 5-day "smallest" cut. |

New questions surfaced by this trace:

| # | New question | My answer |
|---|---|---|
| 7 | How does a manual reviewer record a numeric reading without ceremony? | A CLI gesture: `kanban kpi record --item <id> --kpi <id> --numeric 18 --note "watched myself"`. The CLI already returns JSON; the UI gets a one-line input box plus a "from CLI" hint for power users. |
| 8 | Where do CI-derived metrics (test coverage, build time, bundle size) come from? | Add a fourth acceptance policy `auto-from-ci` plus a `kanban kpi record-ci` CLI gesture so a CI workflow can post numbers. Or treat them as `auto-from-validator` with a reserved `validatorCheck` value of `ci:<job>`. **Recommendation**: defer to Phase C. In Phase B, CI metrics are recorded via `manual` source with the CI URL pasted into the note field. Cheap; works. |
| 9 | Sub-KPI rollup aggregation policy? | Default `latest`. Add an `aggregate: "latest" | "sum" | "min" | "max" | "all-must-meet"` field on the parent KPI. For our example, KPI #2's `aggregate` would be `sum`. |
| 10 | What does `kpi_coverage` do for `auto-from-validator` KPIs in Phase B? | Skip them — they're declared-but-unverified by design until Phase C. UI shows a separate "Phase C will measure this" hint badge so the reviewer knows it isn't a forgotten measurement. |
| 11 | Sub-KPI confirmation in the validation flow — combined with accept, or separate? | Separate. Sub-KPI readings come from the agent at deliverable-write time; the reviewer's accept gesture is unchanged. The panel surfaces sub-KPIs informationally, lets the reviewer override, but doesn't gate accept on sub-KPI completeness — the `kpi_coverage` validator check already catches missing readings before accept is offered. |

## Step 9 — net rating of the design

Schema and acceptance-policy plumbing: **sound**. Three target kinds
were enough; three acceptance policies map onto a real example
naturally.

Status semantics (`open` / `met` / `missed` / `waived`): **sound**.
The `missed` distinct from `open` was a non-obvious call in the doc;
the trace confirmed it earns its place — KPI #6's "78% < 80%" reading
needs `missed` so the reviewer is forced to waive or reject.

Sub-KPI rollup: **needs the aggregation policy fix** (open question 9).
The doc's "latest reading wins" is wrong for any KPI that aggregates
across multiple tasks. Without this fix, the design will produce
silently wrong results.

`kpi_coverage` validator check: **sound**. Catches the gap. The
"what about auto-from-validator" call (Q10) is a small sharpening,
not a redesign.

Review UI: **scales to 8 KPIs**. The `[N KPIs blocking auto-promote]`
banner is necessary, not optional.

CI-derived metrics: **deferred sensibly to Phase C**. In Phase B
they're entered via `manual` with a note. Not pretty, works.

Phase-B scope: I'd commit to the **fuller** ~10-day cut, not the
~5-day "smallest" cut. The rollup-aggregation fix and the
sub-KPI/validator-flow split are load-bearing.

## What I'd change in the design doc before code

1. **Add `aggregate` to `projectKpiSchema`** (open question 9). Without
   this the design ships wrong defaults.
2. **Commit answer for `auto-from-validator` in Phase B** (Q10):
   skip + UI hint, don't ignore silently.
3. **Commit answer for sub-KPI confirmation flow** (Q11): informational,
   don't gate accept.
4. **Reframe Phase-B scope** — drop the "smallest 5-day slice" framing
   in favor of the ~10-day commit, because we now know which gaps that
   shorter slice would have left.
5. **Add a §"What does NOT change in Phase B"** section so the
   non-goals are crisp: no CI integration, no time-series, no automatic
   override expiry, no cross-item dashboard.

The first three are concrete schema/behavior fixes — patches to the
doc, not new design. The last two are framing.

## Recommendation

Update `kpi-tracking-design.md` with the four schema/behavior fixes and
the framing change above, then start Phase B implementation. Branches
roughly:

1. `feat/kpi-schema-and-validator` — schema (with `aggregate`),
   `kpi_coverage` check, both UI helpers (lookup, target compatibility).
2. `feat/kpi-review-ui` — KPI panel, sub-KPI section in the validation
   panel, board badge.
3. `feat/kpi-cli-and-rollup` — CLI commands, sub-KPI rollup with
   aggregation, override flow, audit append.

Three branches, ~10 days total. After they land we have enough real
usage to design Phase C with the same paper-trace technique.
