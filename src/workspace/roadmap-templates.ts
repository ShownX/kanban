import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoadmapTemplateSpec {
	slug: string;
	requirements?: string;
	design?: string;
	tasks?: string;
}

export interface RoadmapTemplate {
	id: string;
	name: string;
	description: string;
	roadmapMarkdown: string;
	specs: RoadmapTemplateSpec[];
}

/** Lightweight summary returned by the list endpoint (excludes full markdown). */
export interface RoadmapTemplateSummary {
	id: string;
	name: string;
	description: string;
	itemCount: number;
}

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

function isoNow(): string {
	return new Date().toISOString();
}

const featureLaunchTemplate: RoadmapTemplate = {
	id: "feature-launch",
	name: "Feature Launch",
	description: "4 items: Core Feature, API Integration, UI/UX, Testing & QA",
	roadmapMarkdown: `# {Template Name} Roadmap

## Introduction
This roadmap tracks the end-to-end delivery of a new feature from core implementation through API integration, user-facing UI, and quality assurance. Each item has a dedicated spec with requirements in EARS notation and starter design notes.

## Items
| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |
|----|-----|-------|-------------|---------------------|------|--------|-------------|
| 1 | TBD | Core Feature | Implement the primary business logic, domain models, and data layer for the feature | All unit tests pass; core logic handles edge cases documented in spec | [spec](specs/core-feature/) | 🔵 Planned | TBD |
| 2 | TBD | API Integration | Build the REST/RPC API surface that exposes the core feature to clients | API contract matches spec; integration tests cover happy path and error responses | [spec](specs/api-integration/) | 🔵 Planned | TBD |
| 3 | TBD | UI/UX | Design and implement the user-facing interface that consumes the API | UI matches design mockups; accessibility audit passes (WCAG 2.1 AA) | [spec](specs/ui-ux/) | 🔵 Planned | TBD |
| 4 | TBD | Testing & QA | End-to-end testing, performance benchmarks, and release sign-off | E2E test suite green; P95 latency within budget; QA sign-off documented | [spec](specs/testing-qa/) | 🔵 Planned | TBD |

## Comments
> [${isoNow()}] @system: Roadmap created from "Feature Launch" template
`,
	specs: [
		{
			slug: "core-feature",
			requirements: `# Core Feature — Requirements

## Functional Requirements

**EARS-FR-1:** When the user initiates the core action, the system **shall** validate all input parameters against the domain schema and return a structured error if validation fails.

**EARS-FR-2:** While the feature is processing a request, the system **shall** persist intermediate state so that recovery is possible after an unexpected failure.

**EARS-FR-3:** When processing completes successfully, the system **shall** emit a domain event that downstream consumers can subscribe to.

## Non-Functional Requirements

**EARS-NFR-1:** Under normal load (up to 100 concurrent requests), the system **shall** respond within 200ms at the 95th percentile.

**EARS-NFR-2:** The system **shall** log all state transitions at INFO level with correlation IDs for traceability.

## Open Questions

- [ ] What is the expected maximum payload size for the core action?
- [ ] Are there rate-limiting requirements at this layer or only at the API gateway?
`,
			design: `# Core Feature — Design

## Overview
The core feature encapsulates domain logic independently of transport (HTTP, gRPC, CLI). It follows a hexagonal architecture with ports for persistence and event publishing.

## Key Components

### Domain Model
- \`FeatureRequest\` — validated input DTO
- \`FeatureResult\` — output DTO with status and payload
- \`FeatureProcessor\` — orchestrates validation, processing, and event emission

### Persistence Port
- Interface: \`FeatureRepository\`
- Default adapter: PostgreSQL via query builder
- Test adapter: in-memory map

### Event Port
- Interface: \`FeatureEventPublisher\`
- Publishes \`FeatureCompleted\` and \`FeatureFailed\` events

## Error Handling
All domain errors extend \`FeatureDomainError\` with a machine-readable code and human-readable message. The API layer maps these to appropriate HTTP status codes.
`,
			tasks: `# Core Feature — Tasks

- [ ] Define domain model types and validation schema
- [ ] Implement FeatureProcessor with unit tests
- [ ] Implement persistence port and PostgreSQL adapter
- [ ] Implement event publisher port and adapter
- [ ] Write integration tests for the full processing pipeline
- [ ] Document domain model in shared interfaces
`,
		},
		{
			slug: "api-integration",
			requirements: `# API Integration — Requirements

## Functional Requirements

**EARS-FR-1:** When a client sends a POST request to the feature endpoint, the system **shall** deserialize the JSON body, invoke the core feature processor, and return the result as JSON with the appropriate HTTP status code.

**EARS-FR-2:** When the request body fails schema validation, the system **shall** return a 400 response with a structured error object listing all validation failures.

**EARS-FR-3:** Where the client provides an \`Idempotency-Key\` header, the system **shall** guarantee exactly-once processing for that key within a 24-hour window.

## Non-Functional Requirements

**EARS-NFR-1:** The API **shall** support content negotiation for JSON (application/json) at a minimum.

**EARS-NFR-2:** All endpoints **shall** require authentication via Bearer token.

## Interface Contract

The API contract between this item and the UI/UX item is documented in \`.kanban/shared-memory/interfaces.md\`.
`,
			design: `# API Integration — Design

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/feature | Create / trigger the feature |
| GET | /api/v1/feature/:id | Retrieve feature result by ID |
| GET | /api/v1/feature | List recent feature results (paginated) |

## Request / Response Shapes

### POST /api/v1/feature
\`\`\`json
{
  "input": { /* validated against FeatureRequest schema */ },
  "idempotencyKey": "optional-uuid"
}
\`\`\`

### Response (success)
\`\`\`json
{
  "id": "uuid",
  "status": "completed",
  "result": { /* FeatureResult */ },
  "createdAt": "ISO-8601"
}
\`\`\`

## Authentication
Bearer token validated via middleware. 401 for missing/invalid tokens, 403 for insufficient scopes.

## Rate Limiting
100 requests per minute per authenticated user. 429 response with Retry-After header.
`,
		},
		{
			slug: "ui-ux",
			requirements: `# UI/UX — Requirements

## Functional Requirements

**EARS-FR-1:** When the user navigates to the feature page, the system **shall** display a form with all required input fields and contextual help text.

**EARS-FR-2:** While the feature is processing, the system **shall** display a loading indicator and disable the submit button to prevent duplicate submissions.

**EARS-FR-3:** When the feature completes, the system **shall** display the result with a success banner and a link to view the full details.

**EARS-FR-4:** When a validation error is returned by the API, the system **shall** display inline field-level error messages.

## Non-Functional Requirements

**EARS-NFR-1:** The page **shall** be fully usable with keyboard navigation only.

**EARS-NFR-2:** The initial page load **shall** complete within 1.5 seconds on a 4G connection.

## Open Questions

- [ ] Do we need optimistic UI updates or wait for server confirmation?
- [ ] Is there a dark mode requirement for this feature?
`,
			design: `# UI/UX — Design

## Component Hierarchy

\`\`\`
FeaturePage
├── FeatureForm
│   ├── InputField (per schema field)
│   ├── SubmitButton
│   └── FormErrorBanner
├── FeatureResultView
│   ├── ResultSummary
│   └── ResultDetails
└── FeatureHistoryList
    └── HistoryRow
\`\`\`

## State Management
- Form state: local component state with controlled inputs
- API state: TanStack Query for fetching/mutation with automatic cache invalidation
- Loading state: derived from mutation status

## API Integration
Consumes the REST API defined in the api-integration spec. Types are shared via the interface contract in \`.kanban/shared-memory/interfaces.md\`.
`,
		},
		{
			slug: "testing-qa",
			requirements: `# Testing & QA — Requirements

## Functional Requirements

**EARS-FR-1:** Before release, the team **shall** execute the full E2E test suite against the staging environment and achieve a 100% pass rate.

**EARS-FR-2:** The QA team **shall** perform exploratory testing covering at least: happy path, edge cases, error states, and concurrent usage.

**EARS-FR-3:** Performance benchmarks **shall** confirm that P95 latency is within the budgets defined in the core feature and API integration specs.

## Exit Criteria

- [ ] E2E test suite passes in CI
- [ ] Performance benchmarks within budget
- [ ] Accessibility audit passes (WCAG 2.1 AA)
- [ ] QA sign-off documented in this spec's tasks
`,
			design: `# Testing & QA — Design

## Test Layers

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest / Jest | Domain logic, utilities |
| Integration | Vitest + Testcontainers | API + database |
| E2E | Playwright | Full user flows |
| Performance | k6 | Load testing API endpoints |
| Accessibility | axe-core + manual | WCAG 2.1 AA compliance |

## CI Pipeline

1. Unit + Integration tests run on every PR
2. E2E tests run on merge to main
3. Performance benchmarks run nightly and on release candidates
4. Accessibility checks integrated into E2E suite

## Sign-off Process
QA engineer reviews test results, files any blocking issues, and adds a sign-off comment to this spec's tasks when complete.
`,
		},
	],
};

const migrationTemplate: RoadmapTemplate = {
	id: "migration",
	name: "Migration",
	description: "3 items: Assessment & Planning, Data Migration, Cutover & Validation",
	roadmapMarkdown: `# {Template Name} Roadmap

## Introduction
This roadmap guides a system migration from legacy infrastructure to the target platform. It emphasizes thorough assessment, incremental data migration with rollback capability, and validated cutover with minimal downtime.

## Items
| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |
|----|-----|-------|-------------|---------------------|------|--------|-------------|
| 1 | TBD | Assessment & Planning | Inventory existing system, map dependencies, define migration strategy and rollback plan | Migration plan approved; risk register complete; rollback procedure documented and tested | [spec](specs/assessment-planning/) | 🔵 Planned | TBD |
| 2 | TBD | Data Migration | Incrementally migrate data from legacy to target system with validation at each stage | All data migrated and verified; checksums match; no data loss confirmed | [spec](specs/data-migration/) | 🔵 Planned | TBD |
| 3 | TBD | Cutover & Validation | Switch traffic to the new system, validate in production, decommission legacy | Zero-downtime cutover complete; monitoring confirms healthy metrics for 48h; legacy decommission plan approved | [spec](specs/cutover-validation/) | 🔵 Planned | TBD |

## Comments
> [${isoNow()}] @system: Roadmap created from "Migration" template
`,
	specs: [
		{
			slug: "assessment-planning",
			requirements: `# Assessment & Planning — Requirements

## Functional Requirements

**EARS-FR-1:** Before migration begins, the team **shall** produce a complete inventory of all legacy system components, including services, databases, cron jobs, and external integrations.

**EARS-FR-2:** The migration plan **shall** include a dependency graph showing the order in which components must be migrated.

**EARS-FR-3:** The rollback plan **shall** define the maximum allowable rollback window and the exact steps to revert each component.

## Non-Functional Requirements

**EARS-NFR-1:** The assessment document **shall** be reviewed and approved by at least two senior engineers and one stakeholder.

**EARS-NFR-2:** The risk register **shall** classify each risk by likelihood and impact, with a mitigation strategy for all high-impact risks.

## Deliverables

- [ ] System inventory document
- [ ] Dependency graph (Mermaid diagram)
- [ ] Migration plan with timeline
- [ ] Rollback procedure (tested in staging)
- [ ] Risk register
`,
			design: `# Assessment & Planning — Design

## Approach

### Discovery Phase
1. Automated infrastructure scan (cloud provider APIs, config management)
2. Manual interview with each service owner
3. Database schema diffing between legacy and target

### Dependency Mapping
Use a directed graph to model service dependencies. Identify clusters that can be migrated independently vs. those requiring coordinated cutover.

\`\`\`mermaid
graph TD
    A[Legacy API Gateway] --> B[Auth Service]
    A --> C[Core Service]
    C --> D[Legacy Database]
    C --> E[Cache Layer]
    B --> F[User Database]
\`\`\`

### Risk Assessment Framework
| Likelihood | Impact | Action |
|-----------|--------|--------|
| High | High | Mitigate before migration |
| High | Low | Accept with monitoring |
| Low | High | Prepare contingency plan |
| Low | Low | Accept |
`,
		},
		{
			slug: "data-migration",
			requirements: `# Data Migration — Requirements

## Functional Requirements

**EARS-FR-1:** The migration **shall** be performed incrementally (table-by-table or entity-by-entity) so that partial progress is preserved if a failure occurs.

**EARS-FR-2:** After each migration batch, the system **shall** compute and compare checksums between source and target to verify data integrity.

**EARS-FR-3:** Where foreign key relationships exist, the migration **shall** respect referential integrity by migrating parent records before child records.

**EARS-FR-4:** The migration tooling **shall** support a dry-run mode that validates the migration plan without writing to the target.

## Non-Functional Requirements

**EARS-NFR-1:** The migration **shall** complete within the planned maintenance window (defined in the assessment phase).

**EARS-NFR-2:** The migration **shall** not degrade legacy system performance by more than 10% during execution (read-replica or CDC-based approach preferred).

## Open Questions

- [ ] Will we use CDC (Change Data Capture) or batch ETL for the migration?
- [ ] What is the maximum acceptable data staleness during the dual-write period?
`,
			design: `# Data Migration — Design

## Strategy: Dual-Write with Backfill

### Phase 1 — Backfill
Migrate historical data from legacy to target in batches. Use cursor-based pagination to avoid full table locks.

### Phase 2 — Dual-Write
Enable writes to both legacy and target systems. Use an async queue to decouple the dual-write path and avoid adding latency to the primary write path.

### Phase 3 — Validation
Run continuous reconciliation jobs comparing record counts, checksums, and sample spot-checks.

### Phase 4 — Cutover
Once validation confirms parity, switch reads to the target system (see cutover-validation spec).

## Rollback
At any phase, the legacy system remains the source of truth. Rollback means:
1. Disable dual-write
2. Drop or archive target data
3. Resume normal legacy operations

No data in the legacy system is modified or deleted during migration.
`,
		},
		{
			slug: "cutover-validation",
			requirements: `# Cutover & Validation — Requirements

## Functional Requirements

**EARS-FR-1:** The cutover **shall** be performed as a zero-downtime traffic shift using weighted routing (e.g., 1% → 10% → 50% → 100%).

**EARS-FR-2:** At each traffic shift increment, the system **shall** compare error rates and latency between legacy and target; the shift **shall** be paused or rolled back if metrics exceed defined thresholds.

**EARS-FR-3:** After 100% cutover, the team **shall** monitor production metrics for at least 48 hours before approving legacy decommission.

## Non-Functional Requirements

**EARS-NFR-1:** The cutover **shall** be executable outside business hours if the service has regional peak traffic patterns.

**EARS-NFR-2:** The rollback from any traffic percentage to 0% on target **shall** complete within 5 minutes.

## Exit Criteria

- [ ] Traffic at 100% on target system
- [ ] Error rate delta < 0.1% for 48h
- [ ] P95 latency within 10% of legacy baseline
- [ ] Legacy decommission plan approved by stakeholder
`,
			design: `# Cutover & Validation — Design

## Traffic Shift Plan

| Step | Target % | Duration | Rollback Trigger |
|------|----------|----------|-----------------|
| 1 | 1% | 1 hour | Error rate > 1% or P95 > 2x baseline |
| 2 | 10% | 4 hours | Error rate > 0.5% delta |
| 3 | 50% | 8 hours | Error rate > 0.2% delta |
| 4 | 100% | 48 hours (soak) | Error rate > 0.1% delta |

## Monitoring Dashboard
Create a dedicated dashboard with:
- Request rate (legacy vs. target)
- Error rate (legacy vs. target)
- P50 / P95 / P99 latency
- Database connection pool utilization
- Queue depth (if applicable)

## Rollback Procedure
1. Set target weight to 0% in load balancer
2. Verify all traffic routes to legacy (< 5 min)
3. Investigate and resolve the issue
4. Resume cutover from the last stable step
`,
		},
	],
};

const refactorTemplate: RoadmapTemplate = {
	id: "refactor",
	name: "Refactor",
	description: "3 items: Analysis & Design, Incremental Refactor, Cleanup & Docs",
	roadmapMarkdown: `# {Template Name} Roadmap

## Introduction
This roadmap structures a codebase refactor that preserves existing behavior while improving internal structure, maintainability, and test coverage. The approach is incremental — no big-bang rewrites — with each step verified by the existing test suite.

## Items
| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |
|----|-----|-------|-------------|---------------------|------|--------|-------------|
| 1 | TBD | Analysis & Design | Audit current codebase, identify pain points, design target architecture, establish test baseline | Architectural decision records written; test coverage baseline measured; refactor plan approved | [spec](specs/analysis-design/) | 🔵 Planned | TBD |
| 2 | TBD | Incremental Refactor | Execute the refactor in small, reviewable PRs that each leave the system in a working state | All planned refactoring PRs merged; no behavior regressions; test coverage at or above baseline | [spec](specs/incremental-refactor/) | 🔵 Planned | TBD |
| 3 | TBD | Cleanup & Docs | Remove dead code, update documentation, and finalize migration of any remaining callsites | Dead code removed; documentation updated; no TODO/FIXME markers from refactor remaining | [spec](specs/cleanup-docs/) | 🔵 Planned | TBD |

## Comments
> [${isoNow()}] @system: Roadmap created from "Refactor" template
`,
	specs: [
		{
			slug: "analysis-design",
			requirements: `# Analysis & Design — Requirements

## Functional Requirements

**EARS-FR-1:** Before refactoring begins, the team **shall** measure and document current test coverage as the baseline that must be maintained or exceeded.

**EARS-FR-2:** The analysis **shall** identify and rank code pain points by frequency of change, bug density, and cognitive complexity.

**EARS-FR-3:** The target architecture **shall** be documented as an Architectural Decision Record (ADR) with context, decision, and consequences.

## Non-Functional Requirements

**EARS-NFR-1:** The refactor plan **shall** decompose the work into PRs of no more than 400 lines of change each to ensure reviewability.

**EARS-NFR-2:** Each PR **shall** be independently deployable — no feature flags or coordinated releases required.

## Deliverables

- [ ] Test coverage baseline report
- [ ] Pain point ranking document
- [ ] Target architecture ADR
- [ ] Refactor plan with PR breakdown
`,
			design: `# Analysis & Design — Design

## Pain Point Analysis Method

1. **Change frequency**: Git log analysis to find most-edited files in the last 6 months
2. **Bug density**: Issue tracker cross-reference with file paths
3. **Cognitive complexity**: Static analysis tooling (ESLint complexity rules, SonarQube)
4. **Developer survey**: Quick async survey asking "which files do you dread touching?"

## Target Architecture Principles

- Single Responsibility: each module has one reason to change
- Dependency Inversion: depend on interfaces, not implementations
- Explicit over implicit: no hidden side effects or global state
- Testability: every component can be tested in isolation with stubs

## Test Coverage Strategy

Use the existing test suite as a safety net. Before each refactoring PR:
1. Run full test suite — must be green
2. Add any missing tests for the code being refactored
3. Make the structural change
4. Run full test suite again — must remain green
`,
		},
		{
			slug: "incremental-refactor",
			requirements: `# Incremental Refactor — Requirements

## Functional Requirements

**EARS-FR-1:** Each refactoring PR **shall** include a "before/after" summary describing what structural change was made and why.

**EARS-FR-2:** The CI pipeline **shall** enforce that test coverage does not drop below the baseline established in the analysis phase.

**EARS-FR-3:** Where a module's public API changes, the PR **shall** update all callsites in the same PR (no broken intermediate states).

## Non-Functional Requirements

**EARS-NFR-1:** Refactoring PRs **shall not** include behavior changes. If a bug is found during refactoring, it **shall** be fixed in a separate PR.

**EARS-NFR-2:** Each PR **shall** be reviewed by at least one engineer who is not the author.

## Open Questions

- [ ] Are there any modules with zero test coverage that need tests added before refactoring?
- [ ] Should we adopt a strangler-fig pattern for any major module boundaries?
`,
			design: `# Incremental Refactor — Design

## Refactoring Sequence

The order of operations matters. Refactor from the leaves of the dependency tree inward:

1. **Utility modules** — pure functions, no dependencies
2. **Data access layer** — extract interfaces, add adapter pattern
3. **Service layer** — break god-objects into focused services
4. **Controller/handler layer** — thin adapters that delegate to services
5. **Cross-cutting concerns** — logging, error handling, middleware

## PR Checklist Template

For each refactoring PR:
- [ ] "Before" snapshot (relevant code structure)
- [ ] "After" snapshot (new structure)
- [ ] Rationale (why this change improves the codebase)
- [ ] Test suite passes (CI green)
- [ ] Coverage at or above baseline
- [ ] No behavior changes (only structural)
`,
		},
		{
			slug: "cleanup-docs",
			requirements: `# Cleanup & Docs — Requirements

## Functional Requirements

**EARS-FR-1:** After the refactor is complete, the team **shall** remove all dead code paths identified during analysis that are no longer reachable.

**EARS-FR-2:** All TODO and FIXME comments introduced during the refactor **shall** be resolved or converted to tracked issues.

**EARS-FR-3:** Public API documentation (JSDoc, README, or API docs) **shall** be updated to reflect the new architecture.

## Non-Functional Requirements

**EARS-NFR-1:** The final test coverage **shall** be at least 5 percentage points above the pre-refactor baseline.

**EARS-NFR-2:** A post-refactor retrospective **shall** be conducted to capture lessons learned.

## Deliverables

- [ ] Dead code removal PR
- [ ] Updated documentation
- [ ] Final coverage report
- [ ] Retrospective notes
`,
			design: `# Cleanup & Docs — Design

## Dead Code Detection

1. Run static analysis to find unreachable exports
2. Cross-reference with integration tests to confirm no runtime usage
3. Remove in a dedicated PR with clear commit message

## Documentation Updates

| Document | Action |
|----------|--------|
| README.md | Update architecture overview |
| API docs | Regenerate from updated JSDoc/TSDoc |
| ADR log | Add final ADR summarizing the refactor outcome |
| Onboarding guide | Update module map and key file locations |

## Retrospective Agenda

1. What went well?
2. What was harder than expected?
3. What would we do differently next time?
4. Are there follow-up refactoring opportunities?
`,
		},
	],
};

const mvpTemplate: RoadmapTemplate = {
	id: "mvp",
	name: "MVP / Greenfield",
	description: "5 items: User Research, Core Backend, Frontend Shell, Integration, Launch Prep",
	roadmapMarkdown: `# {Template Name} Roadmap

## Introduction
This roadmap bootstraps a new product from zero to a shippable MVP. It starts with user research to validate assumptions, runs backend and frontend development in parallel, integrates them, and prepares for launch. The emphasis is on shipping fast with a tight scope.

## Items
| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |
|----|-----|-------|-------------|---------------------|------|--------|-------------|
| 1 | TBD | User Research | Define target persona, validate problem hypothesis, and establish MVP scope | User interviews complete (minimum 5); problem hypothesis validated; MVP scope document approved | [spec](specs/user-research/) | 🔵 Planned | TBD |
| 2 | TBD | Core Backend | Build the essential API and data layer that supports the MVP feature set | API serves all MVP endpoints; seed data loads correctly; basic auth implemented | [spec](specs/core-backend/) | 🔵 Planned | TBD |
| 3 | TBD | Frontend Shell | Scaffold the frontend application with routing, auth flow, and core page layouts | App boots, authenticates, and renders all core pages with mock data | [spec](specs/frontend-shell/) | 🔵 Planned | TBD |
| 4 | TBD | Integration | Connect frontend to live backend, implement error handling, and polish UX | All pages work with live data; error states handled gracefully; no console errors | [spec](specs/integration/) | 🔵 Planned | TBD |
| 5 | TBD | Launch Prep | Production infrastructure, monitoring, and go-to-market checklist | Infrastructure provisioned; monitoring dashboards live; launch checklist complete | [spec](specs/launch-prep/) | 🔵 Planned | TBD |

## Comments
> [${isoNow()}] @system: Roadmap created from "MVP / Greenfield" template
`,
	specs: [
		{
			slug: "user-research",
			requirements: `# User Research — Requirements

## Functional Requirements

**EARS-FR-1:** The team **shall** conduct at least 5 user interviews with representatives of the target persona.

**EARS-FR-2:** The interview findings **shall** be synthesized into a problem hypothesis statement using the format: "[Persona] needs [capability] because [reason], but currently [pain point]."

**EARS-FR-3:** The MVP scope **shall** be defined as a prioritized list of user stories with MoSCoW classification (Must / Should / Could / Won't).

## Deliverables

- [ ] Interview script and participant criteria
- [ ] Interview notes (anonymized)
- [ ] Problem hypothesis statement
- [ ] MVP scope document with MoSCoW priorities
- [ ] Success metrics definition (what does "working" look like?)
`,
			design: `# User Research — Design

## Interview Framework

### Participant Criteria
- Actively experiences the problem we're solving
- Willing to spend 30 minutes on a video call
- Mix of technical and non-technical users

### Interview Script Structure
1. Context (2 min): What do you do? What tools do you use?
2. Problem exploration (10 min): Walk me through the last time you experienced [problem]
3. Current workarounds (5 min): How do you solve this today?
4. Solution validation (10 min): Show rough wireframes, gauge reaction
5. Wrap-up (3 min): What would make you switch to a new tool?

### Synthesis Method
Affinity mapping of interview notes → identify top 3 recurring themes → validate against problem hypothesis.

## MVP Scope Decision Framework
Include in MVP if: solves the #1 pain point AND can be built in ≤ 2 weeks AND doesn't require third-party integrations that add risk.
`,
		},
		{
			slug: "core-backend",
			requirements: `# Core Backend — Requirements

## Functional Requirements

**EARS-FR-1:** The backend **shall** expose a RESTful API with endpoints for all CRUD operations defined in the MVP scope document.

**EARS-FR-2:** The backend **shall** implement authentication using JWT tokens with a minimum expiry of 1 hour and a refresh token flow.

**EARS-FR-3:** The database schema **shall** support the data model defined in the MVP scope, with migrations managed by a version-controlled migration tool.

## Non-Functional Requirements

**EARS-NFR-1:** The API **shall** return structured JSON error responses with a consistent shape: \`{ error: { code, message, details? } }\`.

**EARS-NFR-2:** All endpoints **shall** validate input using a schema validation library (e.g., Zod, Joi) before processing.

## Open Questions

- [ ] Which database engine (PostgreSQL, SQLite, etc.)?
- [ ] Hosted auth service or self-managed JWT?
- [ ] Do we need WebSocket support for the MVP?
`,
			design: `# Core Backend — Design

## Tech Stack
- Runtime: Node.js with TypeScript
- Framework: TBD (Express, Fastify, or Hono)
- Database: PostgreSQL with Drizzle ORM
- Auth: JWT with refresh tokens
- Validation: Zod schemas

## API Structure

\`\`\`
src/
├── routes/          # Route handlers (thin)
├── services/        # Business logic
├── repositories/    # Data access
├── middleware/       # Auth, validation, error handling
├── schemas/         # Zod schemas (shared with frontend)
└── db/
    ├── migrations/  # SQL migrations
    └── schema.ts    # Drizzle schema
\`\`\`

## Development Approach
1. Define Zod schemas first (these become the contract with frontend)
2. Implement database schema + migrations
3. Build repositories (data access layer)
4. Build services (business logic)
5. Wire up routes + middleware
6. Seed data for development

Frontend can start development immediately after step 1, using the Zod schemas as the API contract.
`,
		},
		{
			slug: "frontend-shell",
			requirements: `# Frontend Shell — Requirements

## Functional Requirements

**EARS-FR-1:** The application **shall** provide client-side routing with pages for all MVP user stories.

**EARS-FR-2:** The application **shall** implement an authentication flow: login page, token storage, automatic redirect to login on 401, and logout.

**EARS-FR-3:** While the backend is unavailable, the application **shall** display a user-friendly error state rather than a blank page or unhandled exception.

## Non-Functional Requirements

**EARS-NFR-1:** The application **shall** be responsive and usable on screens from 375px (mobile) to 1440px (desktop).

**EARS-NFR-2:** The initial page load **shall** complete within 2 seconds on a 4G connection (Lighthouse performance score ≥ 80).

## Open Questions

- [ ] React, Vue, or Svelte?
- [ ] CSS framework (Tailwind, CSS Modules, etc.)?
- [ ] Should we implement a design system from the start or iterate?
`,
			design: `# Frontend Shell — Design

## Tech Stack
- Framework: React with TypeScript
- Routing: React Router or TanStack Router
- Styling: Tailwind CSS
- API client: TanStack Query + fetch wrapper
- Forms: React Hook Form + Zod resolvers (shared schemas with backend)

## Page Structure

| Route | Page | Priority |
|-------|------|----------|
| /login | Auth page | Must |
| / | Dashboard / home | Must |
| /[resource] | List view | Must |
| /[resource]/:id | Detail view | Must |
| /settings | User settings | Should |

## Component Architecture
- \`layouts/\` — page shells (sidebar, header, content area)
- \`pages/\` — route-level components
- \`features/\` — feature-specific components and hooks
- \`components/ui/\` — reusable primitives (button, input, card, etc.)

## Mock Data Strategy
Use MSW (Mock Service Worker) to intercept API calls with realistic mock data during frontend-only development. Remove MSW handlers as real endpoints come online.
`,
		},
		{
			slug: "integration",
			requirements: `# Integration — Requirements

## Functional Requirements

**EARS-FR-1:** When the frontend and backend are integrated, all MVP user flows **shall** work end-to-end with live data (no mock data remaining).

**EARS-FR-2:** The frontend **shall** handle all API error states: network failure, 4xx validation errors, 5xx server errors, and timeout.

**EARS-FR-3:** The loading and empty states for all data-driven pages **shall** be implemented with appropriate visual feedback.

## Non-Functional Requirements

**EARS-NFR-1:** There **shall** be no unhandled promise rejections or console errors during normal usage flows.

**EARS-NFR-2:** API calls **shall** include retry logic for transient failures (5xx, network errors) with exponential backoff.

## Exit Criteria

- [ ] All MVP user flows pass manual walkthrough
- [ ] No console errors during normal usage
- [ ] Error states tested (kill backend, test each error path)
- [ ] Loading states visible for all async operations
`,
			design: `# Integration — Design

## Integration Checklist

For each API endpoint:
1. Remove MSW mock handler
2. Connect to real endpoint via API client
3. Verify happy path works
4. Test error states (validation, server error, network failure)
5. Verify loading state displays correctly
6. Check empty state (no data scenario)

## Error Handling Strategy

| Error Type | UI Treatment |
|-----------|-------------|
| Network failure | Toast notification + retry button |
| 400 Validation | Inline field errors |
| 401 Unauthorized | Redirect to login |
| 403 Forbidden | "Access denied" message |
| 404 Not found | "Not found" page |
| 5xx Server error | Toast + "Try again later" |
| Timeout | Toast + automatic retry (3x) |

## Polish Priorities
1. Loading skeletons for all data-driven components
2. Optimistic updates for mutations where appropriate
3. Debounced search inputs
4. Proper focus management after navigation
`,
		},
		{
			slug: "launch-prep",
			requirements: `# Launch Prep — Requirements

## Functional Requirements

**EARS-FR-1:** The production infrastructure **shall** be provisioned using infrastructure-as-code (Terraform, CDK, or Pulumi).

**EARS-FR-2:** Monitoring **shall** include: uptime checks, error rate alerts, and a dashboard showing key business and technical metrics.

**EARS-FR-3:** The team **shall** complete a launch checklist covering: DNS, SSL, backups, logging, error tracking, and analytics.

## Non-Functional Requirements

**EARS-NFR-1:** The production database **shall** have automated daily backups with a retention period of at least 30 days.

**EARS-NFR-2:** The deployment pipeline **shall** support zero-downtime deployments.

## Launch Checklist

- [ ] Domain and DNS configured
- [ ] SSL certificate provisioned (auto-renewal)
- [ ] Production database provisioned with backups
- [ ] CI/CD pipeline deploying to production
- [ ] Error tracking service configured (Sentry, etc.)
- [ ] Uptime monitoring configured
- [ ] Analytics / event tracking integrated
- [ ] Privacy policy and terms of service published
- [ ] Load testing completed (target: 2x expected launch traffic)
`,
			design: `# Launch Prep — Design

## Infrastructure

### Compute
- Container-based deployment (Docker)
- Auto-scaling based on CPU/memory thresholds
- Health check endpoint: GET /health

### Database
- Managed PostgreSQL instance
- Automated daily backups (30-day retention)
- Read replica for analytics queries (post-launch)

### CDN / Static Assets
- Frontend served via CDN (CloudFront, Vercel, etc.)
- Cache headers configured for immutable assets

## Monitoring Stack

| Component | Tool | Alert Threshold |
|-----------|------|----------------|
| Uptime | Pingdom / UptimeRobot | Down > 1 min |
| Errors | Sentry | > 10 errors/min |
| Metrics | Grafana + Prometheus | P95 latency > 500ms |
| Logs | CloudWatch / Datadog | Error log spike |

## Launch Day Runbook

1. Final smoke test on staging
2. Merge release branch to main
3. Monitor deployment pipeline
4. Verify production health checks
5. Enable DNS cutover
6. Monitor dashboards for 2 hours
7. Announce launch
`,
		},
	],
};

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const ALL_TEMPLATES: RoadmapTemplate[] = [featureLaunchTemplate, migrationTemplate, refactorTemplate, mvpTemplate];

export function getTemplates(): RoadmapTemplate[] {
	return ALL_TEMPLATES;
}

export function getTemplateById(id: string): RoadmapTemplate | undefined {
	return ALL_TEMPLATES.find((t) => t.id === id);
}

export function getTemplateSummaries(): RoadmapTemplateSummary[] {
	return ALL_TEMPLATES.map((t) => ({
		id: t.id,
		name: t.name,
		description: t.description,
		itemCount: t.specs.length,
	}));
}

// ---------------------------------------------------------------------------
// Apply template
// ---------------------------------------------------------------------------

export async function applyTemplate(
	workspacePath: string,
	templateId: string,
	projectName?: string,
	force?: boolean,
): Promise<{ success: boolean; error?: string }> {
	const template = getTemplateById(templateId);
	if (!template) {
		return { success: false, error: `Unknown template ID: "${templateId}"` };
	}

	const kanbanDir = join(workspacePath, ".kanban");
	const roadmapPath = join(kanbanDir, "ROADMAP.md");

	if (!force) {
		try {
			await readFile(roadmapPath, "utf8");
			return { success: false, error: "ROADMAP.md already exists. Remove it first to apply a template." };
		} catch {
			// File does not exist — proceed.
		}
	}

	// Prepare roadmap markdown with optional project name substitution.
	const displayName = projectName?.trim() || template.name;
	const roadmapContent = template.roadmapMarkdown.replace(/\{Template Name\}/g, displayName);

	// Write ROADMAP.md
	await mkdir(kanbanDir, { recursive: true });
	await writeFile(roadmapPath, roadmapContent, "utf8");

	// Write spec directories and starter files
	const specsDir = join(kanbanDir, "specs");
	for (const spec of template.specs) {
		const specDir = join(specsDir, spec.slug);
		await mkdir(specDir, { recursive: true });

		if (spec.requirements) {
			await writeFile(join(specDir, "requirements.md"), spec.requirements, "utf8");
		}
		if (spec.design) {
			await writeFile(join(specDir, "design.md"), spec.design, "utf8");
		}
		if (spec.tasks) {
			await writeFile(join(specDir, "tasks.md"), spec.tasks, "utf8");
		}
	}

	// Create shared-memory directory with empty starter files
	const sharedMemoryDir = join(kanbanDir, "shared-memory");
	await mkdir(sharedMemoryDir, { recursive: true });

	const interfacesPath = join(sharedMemoryDir, "interfaces.md");
	const decisionsPath = join(sharedMemoryDir, "decisions.md");

	// Only write if they don't exist yet
	try {
		await readFile(interfacesPath, "utf8");
	} catch {
		await writeFile(interfacesPath, "# Interface Contracts\n\n_No contracts defined yet._\n", "utf8");
	}

	try {
		await readFile(decisionsPath, "utf8");
	} catch {
		await writeFile(decisionsPath, "# Architectural Decisions\n\n_No decisions recorded yet._\n", "utf8");
	}

	return { success: true };
}
