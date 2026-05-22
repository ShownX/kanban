import { describe, expect, it } from "vitest";

import { parseDeliverableMd } from "../../src/workspace/deliverable-file";

describe("parseDeliverableMd", () => {
	it("extracts metadata, summary, requirements, files, and questions", () => {
		const md = `# Task t_login01: User login

**Roadmap item:** \`roadmap_auth01\`
**Roadmap version:** 3
**Agent:** agent:auth_01
**Completed:** 2026-05-22T12:00:00.000Z

## Summary
Implemented email-password login with session cookies.

## Requirements check
- [x] US-1: Sign in — src/auth/login.ts:42 (test passes)
- [~] US-2: 2FA — only TOTP, SMS deferred
- [ ] US-3: Magic link — not in v1

## Changed files
- src/auth/login.ts
- src/auth/session.ts
- test/auth/login.test.ts

## Open questions
- Do we need password strength meter in v1?
`;

		const parsed = parseDeliverableMd(md, "t_login01");

		expect(parsed.taskId).toBe("t_login01");
		expect(parsed.roadmapItemId).toBe("roadmap_auth01");
		expect(parsed.roadmapVersion).toBe(3);
		expect(parsed.agent).toBe("agent:auth_01");
		expect(parsed.completedAt).toBe("2026-05-22T12:00:00.000Z");
		expect(parsed.summary).toContain("session cookies");
		expect(parsed.requirementsCheck).toHaveLength(3);
		expect(parsed.requirementsCheck[0]).toMatchObject({ status: "met" });
		expect(parsed.requirementsCheck[1]).toMatchObject({ status: "partial" });
		expect(parsed.requirementsCheck[2]).toMatchObject({ status: "skipped" });
		expect(parsed.changedFiles).toEqual(["src/auth/login.ts", "src/auth/session.ts", "test/auth/login.test.ts"]);
		expect(parsed.openQuestions).toEqual(["Do we need password strength meter in v1?"]);
		expect(parsed.workSummary).toBeUndefined();
	});

	it("extracts work summary jobs, commands, and duration", () => {
		const md = `# Task t_perf01: Optimize cold start

**Roadmap item:** \`roadmap_perf01\`
**Duration:** 2m 30s

## Summary
Reduced cold start from 1.2s to 350ms.

## Work summary
- [x] Profile cold start with Chrome perf — captured baseline.json
- [x] Move heavy imports behind dynamic() — saved 600ms
- [~] Inline critical CSS — only landing page so far
- [!] Switch bundler to esbuild — broke source maps, reverted
- [ ] Migrate analytics to lazy load

## Commands
- \`npm test\`
- pnpm build
- ./scripts/bench.sh

## Requirements check
- [x] REQ-1: Cold start under 500ms

## Changed files
- src/main.ts
`;

		const parsed = parseDeliverableMd(md, "t_perf01");

		expect(parsed.workSummary).toBeDefined();
		const work = parsed.workSummary;
		if (!work) throw new Error("missing work summary");
		expect(work.jobs).toHaveLength(5);
		expect(work.jobs[0]).toMatchObject({ status: "done", title: "Profile cold start with Chrome perf" });
		expect(work.jobs[0]?.detail).toBe("captured baseline.json");
		expect(work.jobs[2]?.status).toBe("partial");
		expect(work.jobs[3]?.status).toBe("failed");
		expect(work.jobs[4]?.status).toBe("skipped");
		expect(work.commands).toEqual(["npm test", "pnpm build", "./scripts/bench.sh"]);
		expect(work.durationMs).toBe(150_000);
	});

	it("returns empty defaults for a sparse deliverable", () => {
		const md = `# Task t_min01: tiny

**Roadmap item:** \`roadmap_x\`

## Summary
Did the thing.
`;
		const parsed = parseDeliverableMd(md, "t_min01");
		expect(parsed.summary).toBe("Did the thing.");
		expect(parsed.requirementsCheck).toEqual([]);
		expect(parsed.changedFiles).toEqual([]);
		expect(parsed.openQuestions).toEqual([]);
		expect(parsed.workSummary).toBeUndefined();
	});
});
