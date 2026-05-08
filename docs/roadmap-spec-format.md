# Roadmap, Spec, and Task Format

This document defines the file formats and agent roles that connect a human's
intent to executed code. It is the companion design for the Roadmap → Task
linkage feature (Milestone 1) and extensions planned in later milestones.

## 1. Principles

1. **Human-readable first.** Every file a human may edit or review renders
   cleanly in a plain markdown viewer. No hidden metadata, no front-matter
   pretending to be a heading.
2. **One file, one owner.** Each document has a primary writer. Other actors
   interact through append-only or comment-shaped extension points, not by
   rewriting authoritative fields.
3. **Clean context per agent.** Each agent has access to the narrowest slice
   of state it needs. Planner agents see the roadmap; task agents see one
   task plus its relevant spec text. They never hold each other's state.
4. **Growth is additive.** Small projects stay as a single file. Large
   projects split into a folder of specs — same schema, different layout.

## 2. The hierarchy

```
Project
 └─ ROADMAP.md                    ← living document, planner <-> human
    └─ Roadmap item (= spec)      ← each heading under "## "
       └─ Tasks (in "### Tasks")  ← one per kanban card
          └─ Deliverable          ← written by the task agent
```

For small or early-stage projects everything stays in `.kanban/ROADMAP.md`.
Large projects may later promote individual roadmap items into standalone
`specs/<id>.md` files, linked from the roadmap. That promotion is mechanical
and preserves IDs; no schema change.

## 3. Agent roles

| Role | Instances | Lifetime | Reads | Writes |
|---|---|---|---|---|
| **Planner** | 1 per project | Persistent | `ROADMAP.md`, all human chat addressed to the project, kanban card state | `ROADMAP.md` (item body, tasks list, answers to open questions) |
| **Task agent** | 1 per card | Ephemeral (lives while the card is in progress) | One card's prompt + the roadmap-item slice it is linked to | Code in its worktree, `deliverable.md` at completion |

Each agent is identified by a stable ID (`planner_01`, `codex_2`, etc.). That
ID appears in files the agent authors so humans can trace provenance.

**Rules enforced by the runtime (not the prompt):**

- A task agent cannot edit `ROADMAP.md`.
- A task agent cannot create new kanban cards (depth limit = 1 in M1; the
  planner does all decomposition).
- The planner cannot edit code in worktrees. It only edits docs.
- The planner can spawn task agents by creating backlog cards linked to a
  roadmap item.

## 4. `.kanban/ROADMAP.md` — the living document

Primary writer: **planner agent**. Human edits freely (source of truth when
they conflict; planner re-syncs on next edit cycle).

Committed to git. Lives at `.kanban/ROADMAP.md`.

### 4.1 Top-level format

```markdown
# Roadmap

<one or more roadmap items, separated by --->
```

### 4.2 Roadmap item format

Each item is one level-2 heading followed by metadata, free-form content,
and optional structured subsections.

**Required fields** (each on its own line, in this order):

```markdown
## <Title>
**ID:** `roadmap_<uuid>`
**Status:** 🔵 Planned | 🟠 In Progress | 🟢 Done
```

**Optional fields** (each on its own line, after Status, before content):

```markdown
**Owner:** agent:<planner-id>      ← which planner agent owns this item
**Version:** <integer>              ← bumps when requirements or design change
**Updated:** <ISO-8601 date>        ← last planner write
```

**Free-form description** follows the metadata block and runs until the
first `###` subsection or the `---` separator.

### 4.3 Optional subsections

Roadmap items may contain any of these level-3 subsections. All are
optional and may appear in any order. A small roadmap item may have none;
a large one may have all five.

#### `### Requirements`

User stories and/or EARS-notation requirements. Each requirement gets a
stable short ID (`US-1`, `NFR-1`, etc.) so tasks can reference it.

```markdown
### Requirements

**US-1: Sign up with email and password**
As a new user, I want to create an account so that I can access the app.

- WHEN a user submits valid signup data
  THE SYSTEM SHALL create a user record and start a session.
- WHEN a user submits an already-registered email
  THE SYSTEM SHALL return a generic "account exists" error.

**NFR-1: Password storage**
- Passwords MUST be hashed with bcrypt, cost ≥ 12.
```

#### `### Design`

Architecture notes, component list, sequence diagrams (mermaid), data model,
error handling strategy, testing strategy. Free-form but structured.

```markdown
### Design

**Components:**
- `src/auth/signup.ts` — signup handler
- `src/auth/session.ts` — session middleware
- `src/auth/password.ts` — bcrypt wrapper

**Sequence: sign in**
\`\`\`mermaid
sequenceDiagram
  Client->>API: POST /auth/signin
  API->>DB: SELECT user
  API-->>Client: Set-Cookie session
\`\`\`
```

#### `### Tasks`

Each task is one level-4 heading. A task maps 1:1 to a kanban card.

```markdown
### Tasks

#### 1. Set up bcrypt password hashing
- **ID:** `t_hash01`
- **Status:** done
- **Requirements:** NFR-1
- **Dependencies:** none

Implement src/auth/password.ts with hash+verify functions.

#### 2. Create user data model and migration
- **ID:** `t_user01`
- **Status:** in_progress
- **Requirements:** US-1
- **Dependencies:** none

Create users table with email (unique), passwordHash, createdAt.

#### 3. Implement signup endpoint
- **ID:** `t_signup01`
- **Status:** backlog
- **Requirements:** US-1
- **Dependencies:** `t_hash01`, `t_user01`

Handle POST /auth/signup. Hash password, insert user, create session.
```

**Task field semantics:**

- **`ID`** — stable `t_<slug>` ID. Same as the kanban card ID.
- **`Status`** — mirrors the kanban column (`backlog`, `in_progress`,
  `review`, `done`). Updated by the runtime when the card moves, not by
  the planner agent. The planner reads it but does not write it.
- **`Requirements`** — back-reference to requirement IDs above.
- **`Dependencies`** — task IDs this task waits on. Wires into the existing
  kanban dependency system. Tasks whose dependencies are all done become
  ready-to-start.

**Task body** (free text after the metadata list) becomes the prompt sent
to the task agent. It should be self-contained enough that the agent can
execute without reading the full roadmap — but can reference requirement
IDs (the runtime will substitute in the relevant requirement text when
sending to the agent).

#### `### Comments`

Append-only log of human input and planner responses. Comments drive the
planner's next action.

```markdown
### Comments

> [2026-05-07T12:00:00Z] @human: Let's use httpOnly cookies, not localStorage.
> [2026-05-07T12:05:00Z] @agent(planner_01): Noted. Updated design section.
> [2026-05-07T14:00:00Z] @human: Do we need password reset in v1?
```

**Comment format:** `> [ISO-8601 timestamp] @<author>: <text>`

- Author is `@human:` or `@agent(<agent-id>):`.
- Comments may span multiple lines; subsequent lines are indented with `> `.
- The planner reads unanswered human comments on each edit cycle and
  either updates the spec or appends a reply asking for clarification.

#### `### Open questions`

Explicit, human-answerable questions that block further work.

```markdown
### Open questions

- [ ] Do we need password reset in v1 or v2?
- [ ] Integration with SSO — in scope or separate roadmap item?
- [x] Rate-limit strategy — same-IP. (answered 2026-05-07)
```

Checkboxes track resolution. The planner surfaces open questions in the
UI. Humans answer by editing the checkbox or adding a comment that
resolves the question (planner re-parses to decide when to tick).

### 4.4 End of item

Each roadmap item ends with `---`.

## 5. `.kanban/roadmap-state.json` — live dashboard (gitignored)

Primary writer: **runtime + kanban UI**. Agents and humans don't edit it
directly.

Tracks transient execution state that would churn the git history if it
lived in `ROADMAP.md`:

- Agent-created task IDs that have not been promoted to the spec
- Agent comments / open questions not yet promoted
- Last-updated timestamps

Gitignored. Regenerated from scratch if deleted. Schema in
`src/workspace/roadmap-state-file.ts`.

## 6. `deliverable.md` — what the task agent writes

Primary writer: **task agent**, at the moment the task moves to `review`.

Lives in the task's worktree at `.kanban/tasks/<task-id>/deliverable.md`.
Optionally committed as part of the task's PR.

```markdown
# Task t_signin01: Implement signin endpoint

**Card:** `t_signin01`
**Roadmap item:** `roadmap_abc123`
**Roadmap version:** 2
**Agent:** codex
**Completed:** 2026-05-07T22:00:00Z

## Summary
Added POST /auth/signin with bcrypt verification and cookie session.

## Requirements check
- [x] US-2: valid credentials start a session — `test/auth.test.ts:45`
- [x] US-2: generic error on wrong password — `test/auth.test.ts:67`
- [~] NFR-2: cookie httpOnly — see open question

## Changed files
4 files, +132/-2. See git diff.

## Open questions
- Should we rate-limit the endpoint? Left for follow-up task.
```

**Why both `.md` and `.json`?** The `.md` is for humans; the `.json`
(optional, generated from the same data) is what the UI parses to surface
status badges, open-question counts, and "stale spec" banners. For M2 we
generate the JSON automatically from the markdown; agents only need to
write the markdown.

## 7. Flow

```
Human initial prompt (chat)
    ↓
Planner agent writes initial ROADMAP.md
    ↓  (items, initial specs via subsections, initial tasks)
Planner triggers task cards for each "### Tasks" entry
    ↓
Task agents start executing (one per card, ephemeral)
    ↓
Task agents write deliverable.md, card moves to review
    ↓
Human reviews:
  - at roadmap level (aggregate status via the Live task status panel)
  - at task level (deliverable + diff)
    ↓
Human adds comments to ROADMAP.md (or clicks "Add comment" in UI)
    ↓
Planner re-reads ROADMAP.md, processes new comments:
  - may update requirements / design / tasks
  - may bump roadmap item **Version:**
  - may create / delete / reword tasks
    ↓
If tasks changed, cards are created / updated / cancelled.
    ↓
(loop)
```

Key invariants:

- **Human is always the final reviewer.** No task ships without human
  approval except when `autoReviewEnabled` is explicitly on per card.
- **Planner agent never surprises the human.** It writes to ROADMAP.md;
  the human sees every change via the normal roadmap editor.
- **Task agents never surprise each other.** No shared state beyond the
  code itself.

## 8. Migration path from M1 to full format

Current M1 state has:
- Stable IDs ✓
- **Tasks:** checkbox section on roadmap items ✓
- No spec subsections yet
- No explicit planner agent

Planned milestones:

- **M2 — Specs-in-roadmap:** extend parser/serializer for `### Requirements`,
  `### Design`, `### Open questions`. Agent-writable Comments section
  normalized. No separate planner agent yet; human writes specs manually.

- **M3 — Planner agent:** introduce `role: "planner"` on agent sessions.
  System-prompt addendum teaches the planner its responsibilities. Planner
  watches chat, edits ROADMAP.md, creates task cards.

- **M4 — Deliverables:** standardize `deliverable.md` + status banners
  based on `Version:` mismatch. Task agents get system-prompt addendum.

- **M5 — Spec split:** for large projects, promote a roadmap item into
  `specs/<roadmap_id>.md`. The ROADMAP.md item becomes a one-line stub with a
  `**Spec:**` link. Parser handles both inline and linked specs.

## 9. Open questions about the format itself

- [ ] Should **Version:** increment per-subsection or per-item? (Currently
      per-item for simplicity.)
- [ ] How do we represent sub-specs (a spec that branches into two
      mutually-exclusive designs)? Probably two sibling roadmap items.
- [ ] Planner agent chat UX: does the planner's reply stream into a
      dedicated panel or blend with the roadmap markdown view?
