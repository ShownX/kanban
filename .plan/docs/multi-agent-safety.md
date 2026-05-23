# Multi-agent cooperation safety primitives

Kanban orchestrates many agents in parallel — project agents, task agents,
validators, planners — that all read and write the same workspace tree. The
modules in this doc are the small, self-contained primitives we ship for
keeping that cooperation safe. None of them assume any particular project
schema; they're meant to be glued onto whatever flow needs them.

## What can go wrong

| Risk | What it looks like |
| --- | --- |
| Scope violation | Project agent A edits a file owned by project B's spec, or a task agent edits files outside the parent spec's `ownedPaths`. |
| Concurrent log writes | Two agents append to the same JSONL log; the writes interleave and produce unparseable lines. |
| Silent log edits | An agent's tool call rewrites a previous changelog entry; the audit trail lies. |
| Overlapping ownership | Two project agents both claim `src/auth/`; their writes race. |
| Dropped boundary checks | Path traversal (`..`), absolute paths, and prefix-only matches (`src/auth` vs `src/authentic`) sneak past naïve string checks. |

## Primitives

### `src/workspace/path-scope.ts`

Pre-write scope guard.

- `checkPathInScope(context, candidatePath)` — returns `null` if the path
  is in scope, otherwise a `PathScopeViolation` with a structured reason
  (`outside_workspace` / `outside_owned_paths` / `no_scope_declared`).
- `assertPathInScope(context, candidatePath)` — same check, throws
  `PathScopeViolationError` on a violation. Use at agent-side write call
  sites where any out-of-scope write is a bug.
- `resolveOwnedPathRoots(context)` — resolve declared paths to absolute
  workspace-rooted paths, dropping any that themselves escape the
  workspace.

The check is built on `path-sandbox.ts:isPathWithinRoot`, which uses
`path.resolve` + `path.relative` so it works on POSIX and Windows and
correctly distinguishes `src/auth` from `src/authentic`. Symlinks are
intentionally NOT resolved on the hot path — agents run inside per-task
git worktrees that limit blast radius, and the validator's
`scope_compliance` check still fires after the fact.

### `src/workspace/owned-paths-conflict.ts`

Cross-claim overlap detection.

- `findOwnedPathsConflicts(workspacePath, leftClaim, rightClaim)` —
  pairwise overlap check; reports every offending path pair.
- `findAllOwnedPathsConflicts(workspacePath, claims)` — sweep every pair
  in a list of claims. Use at project-agent creation time to refuse a
  card whose `ownedPaths` collide with an existing project.
- `dedupOwnedPaths(workspacePath, paths)` — collapse a single claim's
  redundant descendants. `["src/auth", "src/auth/login.ts"]` → `["src/auth"]`.

Each conflict carries a `relationship: "equal" | "left_contains_right" |
"right_contains_left"` so callers can tailor the error message.

### `src/fs/locked-jsonl-append.ts`

Concurrency-safe JSONL append.

- `appendJsonLine(path, payload)` — serializes one entry as a JSON line
  under an exclusive file lock (built on the existing
  `proper-lockfile`-based `lockedFileSystem` primitive). Inserts a
  trailing newline before appending if a previous writer crashed
  mid-line, so the next read still parses cleanly.
- `readJsonLines<T>(path)` — read and parse, skipping malformed lines.

### `src/workspace/activity-log.ts`

Tamper-evident append-only log built on top of `appendJsonLine`.

Each entry carries a `seq` counter, a `prevHash` referencing the previous
entry's hash, and its own `hash` over `(agent, event, payload, recordedAt,
seq, prevHash)`. `verifyActivityLog(path)` walks the chain and reports the
first broken entry plus the failure reason
(`hash_mismatch` / `chain_broken` / `non_monotonic_seq`). Catches:

- Accidental edits by another agent's tool call.
- Out-of-order replays.
- Truncated middles (deleted entries break the chain immediately).

This is **not** a defense against an attacker who can rewrite the entire
file (they can recompute the chain). For real attack-resistance, anchor
periodic hashes to git (e.g., commit the head hash to a tracked file).

## CLI surface

`kanban safety …` subcommands wrap the primitives for headless workflows
(agents, hook scripts, CI). They emit JSON on stdout and exit non-zero
on any flagged condition, so downstream code can branch on exit status.

```bash
# Pre-write scope check, fed via env (suitable as a pre-write hook)
KANBAN_WORKSPACE=/repo KANBAN_OWNED_PATHS=src/auth/ \
  kanban safety check-path --path src/auth/login.ts

# Pre-write scope check via flags
kanban safety check-path \
  --path src/auth/login.ts \
  --owned src/auth/,src/types/auth.ts \
  --workspace /repo

# Detect overlapping project agents
kanban safety check-overlap --workspace /repo --claims-json '[
  {"id":"auth","ownedPaths":["src/auth"]},
  {"id":"auth-login","ownedPaths":["src/auth/login.ts"]}
]'

# Minimize a single claim's owned paths
kanban safety dedup-paths --owned src/auth,src/auth/login.ts --workspace /repo

# Verify a tamper-evident log
kanban safety verify-log --log .kanban/activity-log.jsonl
```

## Integration patterns

These primitives are foundations, not policies. Suggested wiring:

1. **Agent-side pre-write**: install a thin hook on the agent's edit tool
   that runs `kanban safety check-path --path <new-path>` and aborts on
   non-zero exit. Cheap to add to existing hook configs (Codex, Cline).

2. **Planner-side validation**: when creating or updating a project
   agent, call `findAllOwnedPathsConflicts` with the existing claims +
   the new one and refuse the operation when the conflict list is
   non-empty.

3. **Shared changelog**: replace ad-hoc `fs.appendFile` on
   `.kanban/shared-memory/changelog.jsonl` with `appendJsonLine`. Pair
   with an `appendActivityLogEntry` mirror for an immutable audit
   trail; periodic `verifyActivityLog` runs (e.g., from the validator)
   surface tampering before reviewers act on stale data.

## What this doesn't try to solve

- **Symlink escape** — would require a stat per write; deferred. Worktree
  isolation contains the blast radius.
- **Full attack-resistance for the activity log** — no external anchor,
  so a determined attacker can rewrite history. Treat as a tripwire, not
  a guarantee.
- **Spec versioning at task start** — the existing validator
  `spec_staleness` check covers the after-the-fact case. A pre-flight
  guard would need a new column on the card schema and is out of scope
  here.
