# Multi-user hosting design

This document is a planning artifact, not a commitment. It scopes what it
would take to turn Kanban from its current local-first single-user shape
into a **hosted multi-user product** where teams sign in with magic links
and see each other's work in real time.

The goal is to be honest about the size of the change, name the load-bearing
decisions, and propose a phased path so the first couple of phases can ship
independently and pay for themselves.

## Where Kanban is today

Kanban is local-first. Every user runs their own binary, against their own
git checkouts, with their own filesystem. Concretely:

- The runtime hub keys data by `workspaceId` but assumes a single trusted
  identity per process — there is no notion of "which user is this".
- All persisted state lives on disk under the host user's home (e.g.
  `~/.cline/kanban/config.json`) or inside the workspace
  (`.kanban/roadmap-state.json`, `.kanban/specs/…`). Nothing is keyed by
  user.
- Agents launch as child processes of the kanban server. They share its
  OS user, its filesystem, its env. No sandbox.
- A "remote mode" already exists — `kanban` started with a non-loopback
  host (e.g. `--host 0.0.0.0`) gates traffic behind a passcode and a
  session cookie, both implemented in `src/security/passcode-manager.ts`.
  But the passcode is a single shared secret, sessions live only in
  memory, and no per-user permission model is enforced on routes.
- The web UI, board state, validation reports, agent terminals, and
  every tRPC procedure assume the requester is the host user.

This is fine — even good — for the local-first product. It is not a
foundation a hosted SaaS can sit on without substantial work.

## What "hosted SaaS with magic-link auth" actually means

The user-facing target is roughly:

> A team signs up at `kanban.example.com`. Each person logs in with their
> email — no password, just a one-time link. They see a dashboard of
> projects/workspaces their org has access to. They can browse boards,
> review tasks, accept or reject validations, and watch agents work in
> real time. Each org's data and agent processes are isolated from every
> other org's. Billing is metered per user or per agent-minute.

To get there from where the codebase is today, every layer changes:

1. **Identity** — replace the single-passcode session model with a real
   user/org/session/token system backed by a database, plus a magic-link
   issuance + verification flow with email delivery.
2. **Authorization** — every workspace-scoped tRPC procedure, every
   websocket connection, every file-serving route has to ask "is this
   user allowed to touch this workspace?".
3. **Multi-tenant data model** — workspaces, roadmap state, deliverables,
   validation reports, review feedback, runtime config, MCP credentials —
   all gain owner / org columns. Some files have to move out of the
   workspace tree (where another user's clone could see them) into a
   per-user store.
4. **Agent isolation** — agents can no longer be plain child processes of
   a shared server. Each agent invocation needs an isolated sandbox
   (container, microVM, or remote build host) with bounded CPU, memory,
   network, and disk; per-tenant filesystem and env; auditable lifecycle.
5. **Persistent shared store** — JSON-on-disk state files are fine for a
   local product but won't survive multi-process or HA hosting. Need a
   database (Postgres) plus object storage (S3-ish) for diffs, reports,
   and large logs.
6. **Operations** — TLS, error reporting, log retention, backups, abuse
   handling, GDPR deletion, status page, on-call. None of this exists.

Honestly: a months-long rewrite. Trying to land it in one branch would
either ship a half-finished product or paralyze single-user development.
The plan below carves it into phases that each have value on their own.

## Phased rollout

Each phase ships standalone. Earlier phases must keep single-user mode
working unchanged, and each one should be revertable.

### Phase 1 — Auth + per-user identity (no agent isolation yet)

**Capability**: a hosted instance with multiple named users who can each
log in with magic links and see only their own workspaces.

What changes:

- New `IdentityProvider` interface with two implementations:
  - `LocalSingleUserProvider` (default; today's behavior — every request
    is treated as the host user `"local"`).
  - `MagicLinkProvider` (new — issues + verifies one-time tokens, persists
    sessions to disk under `~/.cline/kanban/server/sessions.sqlite`).
- A `User` record with `id`, `email`, `displayName`, `createdAt`,
  `lastLoginAt`, `role: "admin" | "member"`. Stored in a small SQLite
  database (`better-sqlite3` is already common in Node tools and zero-
  ops). One file per host instance, easy to back up.
- A `Session` record with `id`, `userId`, `issuedAt`, `expiresAt`,
  `lastUsedAt`, `userAgent`. Sessions are HTTP-only secure cookies;
  validated on every request through middleware.
- HTTP routes:
  - `POST /api/auth/request-magic-link` — body: `{ email }`. Issues a
    short-lived (15 min) one-time token and emails it. Rate-limited per
    IP and per email.
  - `GET /api/auth/verify?token=…` — exchanges the token for a session,
    sets the cookie, redirects to the app.
  - `POST /api/auth/logout` — invalidates the session.
  - `GET /api/auth/me` — current user (or 401).
- Mailer abstraction: `Mailer` interface with `send({ to, subject, body
  })`. Two implementations:
  - `ConsoleMailer` — logs the magic-link URL to stdout. Default in dev.
  - `ResendMailer` (or `SmtpMailer`) — pluggable; reads a token from
    env. Optional in this phase.
- A login page. Single email field, "send link" button, "check your
  email" success state, error states for rate-limit and invalid tokens.
- `Workspace` records gain an `ownerUserId`. Existing local workspaces
  migrate to the synthetic `local` user on first start.
- Every workspace-scoped tRPC procedure adds an authorization step:
  `requireUserCanReadWorkspace(currentUser, workspaceId)`. The runtime
  context already carries `workspaceScope`; it gains a `currentUser`.
- The websocket runtime hub authenticates via the same session cookie
  on the upgrade request and rejects connections without a valid one.
- The web UI gains a thin `useCurrentUser()` and a logout control in
  the top bar.

What does **not** change in Phase 1:

- Agents still run as child processes of the kanban server, with full
  filesystem access. A logged-in user with valid auth can still own
  workspaces and run agents on the same host. This is fine for a small
  trusted team self-hosting; it's NOT acceptable for a public SaaS.
- File layout. `.kanban/…` files still live in the workspace tree and
  mostly stay readable to whoever can read the disk. We're explicit
  about that; isolation lands in Phase 3.
- Billing, plans, limits.

Risk surface in Phase 1:

- The session/token store is the new single point of compromise. Tokens
  are 32-byte random; sessions are HTTP-only secure cookies; logout
  invalidates server-side. We rate-limit auth endpoints and burn tokens
  on use.
- Email delivery is the new external dependency. Failure modes
  (provider outage, deliverability) need fallback paths — at minimum,
  surface a clear error and let an admin issue a session manually via
  CLI.
- Remote-mode passcode flow stays as a fallback for self-hosted users
  who don't want to set up email; the magic-link flow layers on top.

Effort: ~1-2 weeks for one person, including tests, docs, and the
login UI. The current passcode + session machinery is reusable as a
starting point for the cookie/middleware code.

### Phase 2 — Org/team model + invitations

**Capability**: multiple users in the same org share workspaces; an
admin invites others by email.

What changes:

- New `Org` record (`id`, `name`, `createdAt`). Every `User` belongs to
  exactly one `Org` in this phase (multi-org membership is a Phase 4+
  concern). Every `Workspace` belongs to an `Org`, not to a single user.
- A simple permission model: `OrgMember` rows with `userId`, `orgId`,
  `role: "admin" | "member"`. Admins can invite, remove, and assign
  roles; members can read all of the org's workspaces and write the
  ones they're explicitly granted.
- `Invitation` records — admin sends an email; recipient clicks the
  link, which creates a user (if needed) and adds them to the org.
- A settings page for org administration: members list, invitations,
  role changes, leave-org control.
- Authorization layer expands: per-route checks now take both the
  user and the workspace's `orgId` into account.

What does **not** change in Phase 2:

- Agent isolation. Still single-host, single-user-on-disk.
- Cross-org sharing. Each workspace lives in exactly one org.

Effort: ~1 week. Mostly schema, UI, and one new mailer template.

### Phase 3 — Agent sandbox + per-tenant filesystem

This is the hard one. **Capability**: agents run in isolated sandboxes;
each tenant's filesystem and env are separated; a malicious or buggy
agent can't read another tenant's data.

What changes:

- A new `AgentSandboxRunner` interface that supersedes today's plain
  `child_process.spawn` for agent processes. Implementations:
  - `LocalUnsandboxedRunner` — current behavior; default in self-hosted
    single-user mode.
  - `ContainerRunner` — the hosted-product implementation. Each agent
    invocation runs in its own container (Docker-compatible runtime, or
    Firecracker/gVisor if attack surface budgets demand it) with:
    - A bind-mount of just the workspace directory.
    - Bounded CPU + memory + wall-clock + disk.
    - No outbound network by default; an explicit allowlist for
      `clinebot.com`, model providers, and similar.
    - A unique env per invocation (no leaking provider secrets into
      sibling tenants).
- The kanban runtime gains a control plane that brokers agent
  start/stop/stream over a stable IPC instead of stdio piped to a
  child process. The CLI agent runners (Cline, Claude Code, Codex, etc.)
  need a thin wrapper inside the sandbox image.
- Workspace files move. Today the workspace IS the user's checkout;
  for hosted, each org's checkout lives in a per-org directory that
  the host process can `chmod 700`. Workspaces become objects we
  provision (clone, init, snapshot) on the user's behalf rather than
  arbitrary host-OS paths.
- Long-lived state moves out of disk JSON files into a database:
  - `roadmap-state.json` → `roadmap_state` rows keyed by `workspaceId`.
  - `users.sqlite`, `sessions.sqlite` → folded into the same
    Postgres-or-SQLite store.
  - `validation-report.md`, `deliverable.md`, `experiment-log/*` —
    keep on the workspace filesystem (committed to git is the point)
    but proxy reads through the runtime, not direct file URLs, so
    we can enforce authz.
- The remote-mode passcode gating becomes optional ("turn off if you
  prefer to rely solely on identity"). Identity is the primary gate.

Risk surface in Phase 3:

- Sandbox escape. The whole product safety story rests on this layer.
  We pick a runtime with an attack-surface story we trust (Firecracker
  or gVisor with default-off network) and write fault-injection tests.
- Filesystem leaks. Path-scope and owned-paths-conflict primitives
  from `feat/multi-agent-safety` enforce per-task scope; per-tenant
  scope adds another layer (bind-mount only the tenant's workspace).
- Resource exhaustion. Cgroups for CPU/memory/disk; per-tenant queues
  with concurrency limits; explicit timeouts everywhere.
- Provider-secret rotation. Model API keys today live on disk in the
  user's home; in hosted mode they're per-org and rotate.

Effort: ~4-6 weeks of focused work. Realistically the first thing that
takes wall-clock weeks rather than days. Worth a separate design doc
(this one references it but doesn't pretend to design it).

### Phase 4 — Operational maturity

**Capability**: production-grade hosting.

What changes (each its own sub-stream):

- Database migrations + backups. Whatever store the app is on by this
  point needs versioned schema migrations, point-in-time recovery, and
  restore drills.
- Audit log. Every privileged action (invite, role change, workspace
  delete, agent run) goes to an append-only log, possibly the same
  hash-chained activity log we shipped in `feat/multi-agent-safety`.
- Quotas + billing. Per-org limits on agent-minutes, workspaces, seats.
  Stripe (or equivalent) plus a metering pipeline.
- Account deletion + data export. GDPR-style. Soft-delete with a
  cooldown; hard-delete bulk-removes the workspace tree, agents,
  sessions, audit-log entries past retention.
- Status page, alerting, error reporting (Sentry already wired for the
  Node side), uptime monitoring, on-call rotation.
- Multi-region story (later). Single-region first.

Effort: months across multiple workstreams. Out of scope for any single
branch.

## Cross-cutting decisions to make before Phase 1 starts

These are the "if we get them wrong now we pay for it for years" calls.

### Database choice

Phase 1 only needs `users`, `sessions`, `magic_link_tokens`, plus
foreign keys against `workspaces`. SQLite via `better-sqlite3` is
plenty for self-hosted. For Phase 2+ (multiple users sharing org data,
read-after-write across processes) we likely want Postgres. The right
move is to write the data layer behind a thin store interface
(`UserStore`, `SessionStore`, `WorkspaceStore`) and back it with SQLite
in Phase 1; swap to Postgres without changing call sites in Phase 2.

### Mailer

Pluggable interface, console default, one production implementation
when it's actually needed. Resend is cheap and has a small SDK; SMTP
covers everyone else. Don't bake in the choice; ship the interface.

### Where does state live?

- Per-user / per-org metadata (users, sessions, orgs, invitations) →
  database (SQLite first, then Postgres).
- Per-workspace state that must travel with git (deliverable.md,
  validation-report.md, experiment-log/*) → workspace tree, unchanged.
- Per-workspace state that must NOT travel with git (roadmap-state.json,
  runtime config, MCP secrets) → today: gitignored disk files. Phase 3:
  database rows scoped by `workspaceId` + `orgId`. Phase 1 keeps them
  on disk to avoid forcing a schema migration before the product story
  is decided.

### Backwards compatibility

Single-user local mode has to keep working through every phase. The
mechanism: pick `LocalSingleUserProvider` when the runtime starts in
non-remote mode (i.e. `--host 127.0.0.1`, the default). Hosted mode
opts in via env var (`KANBAN_AUTH_PROVIDER=magic-link`), CLI flag, or
config file. No flag, no behavior change.

### Telemetry + privacy

Hosted means we'll see usage data we currently don't. Decide upfront
what's collected, where it's stored, how long, and what users can
opt out of. PostHog is already wired in the web UI; the hosted product
should give an explicit toggle and respect DNT.

## What lands in this branch (`feat/multi-user-hosting-design`)

Just this document. No code. The point of the design doc is to build
shared understanding before committing the engineering time. Once
you've read and edited this, the natural next branches are:

1. `feat/auth-identity-provider` — Phase 1, behind a feature flag.
   Default-off; single-user mode untouched.
2. `feat/auth-org-model` — Phase 2.
3. `feat/agent-sandbox-runner` — Phase 3 (probably its own design doc
   first; it's bigger than Phase 1 and 2 combined).
4. `feat/hosted-ops` — Phase 4 sub-streams.

## Open questions (please weigh in)

1. **Self-hosted vs SaaS-only.** Today many users self-host the binary.
   Do we want Phase 1 to make the auth flow turn-keyable for self-hosters
   (just set `KANBAN_AUTH_PROVIDER=magic-link` and a Resend API key, get
   a working multi-user instance), or only target the hosted product?
   Pulling self-hosters along is more work but expands the addressable
   audience and gives us early dogfooding.
2. **Org boundary.** Phase 2 assumes one user belongs to exactly one
   org. Is that going to bite us in 6 months when a contractor wants
   to be a member of two client orgs? If so, model multi-org membership
   from the start (slightly more schema, materially more UI).
3. **Sandbox runtime.** Firecracker vs gVisor vs plain Docker — this is
   a multi-week call on its own. Punt to its own doc, but flag the
   decision now so it doesn't surprise anyone when Phase 3 starts.
4. **Per-org model API keys.** Do we want users to bring their own
   provider keys (BYOK; we're a thin orchestration layer) or do we
   front the keys ourselves and bill agent-minutes? Each has very
   different ops + business implications.
5. **Migration story for existing single-user installs.** When a
   self-hoster turns on auth, what happens to the workspace they were
   using? Auto-claim by the email matching their git config?
   Manually-attached during first login? This shapes the Phase 1 UX.
