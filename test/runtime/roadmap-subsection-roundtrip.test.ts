import { describe, expect, it } from "vitest";

import { parseRoadmapMarkdown, serializeRoadmap } from "../../src/workspace/roadmap-file";

describe("roadmap subsection round-trip", () => {
	it("parses and serializes a full-fat roadmap item with all subsections", () => {
		const input = `# Roadmap

## Add user authentication
**ID:** \`roadmap_auth01\`
**Status:** 🟠 In Progress
**Version:** 2
**Owner:** agent:planner_01

Support email+password login.

### Requirements

**US-1: Sign up**
- WHEN a user submits valid data THE SYSTEM SHALL create an account.

### Design

**Components:**
- \`src/auth/signup.ts\`
- \`src/auth/session.ts\`

### Tasks

- [ ] \`t_hash01\` Set up bcrypt
- [x] \`t_user01\` Create user model _(agent-created)_

### Open questions

- [ ] Do we need password reset in v1?
- [x] Rate-limit strategy decided.

### Comments

> [2026-05-07T12:00:00.000Z] @human: Use httpOnly cookies.
> [2026-05-07T12:05:00.000Z] @agent(planner_01): Updated design.

---
`;
		const items = parseRoadmapMarkdown(input);
		expect(items).toHaveLength(1);
		const item = items[0]!;
		expect(item.id).toBe("roadmap_auth01");
		expect(item.status).toBe("in_progress");
		expect(item.version).toBe(2);
		expect(item.owner).toBe("agent:planner_01");
		expect(item.description).toContain("email+password login");
		expect(item.requirements).toContain("US-1: Sign up");
		expect(item.design).toContain("src/auth/signup.ts");
		expect(item.tasks).toHaveLength(2);
		expect(item.tasks[0]?.taskId).toBe("t_hash01");
		expect(item.tasks[1]?.agentCreated).toBe(true);
		expect(item.linkedTaskIds).toEqual(["t_hash01", "t_user01"]);
		expect(item.openQuestions).toHaveLength(2);
		expect(item.openQuestions[0]?.resolved).toBe(false);
		expect(item.openQuestions[1]?.resolved).toBe(true);
		expect(item.comments).toHaveLength(2);
		expect(item.comments[0]?.text).toBe("@human: Use httpOnly cookies.");

		// Round-trip
		const serialized = serializeRoadmap(items);
		expect(serialized).toContain("### Requirements");
		expect(serialized).toContain("### Design");
		expect(serialized).toContain("### Tasks");
		expect(serialized).toContain("### Open questions");
		expect(serialized).toContain("### Comments");
		expect(serialized).toContain("**Version:** 2");
		expect(serialized).toContain("**Owner:** agent:planner_01");

		const reparsed = parseRoadmapMarkdown(serialized);
		expect(reparsed).toHaveLength(1);
		expect(reparsed[0]!.id).toBe("roadmap_auth01");
		expect(reparsed[0]!.requirements).toContain("US-1");
		expect(reparsed[0]!.tasks).toHaveLength(2);
		expect(reparsed[0]!.openQuestions).toHaveLength(2);
	});

	it("parses a minimal item with just title and status", () => {
		const input = `# Roadmap

## Simple item
**ID:** \`roadmap_simple\`
**Status:** 🔵 Planned

---
`;
		const items = parseRoadmapMarkdown(input);
		expect(items).toHaveLength(1);
		const item = items[0]!;
		expect(item.id).toBe("roadmap_simple");
		expect(item.status).toBe("planned");
		expect(item.description).toBe("");
		expect(item.requirements).toBeUndefined();
		expect(item.design).toBeUndefined();
		expect(item.tasks).toEqual([]);
		expect(item.openQuestions).toEqual([]);
		expect(item.comments).toEqual([]);
	});

	it("parses legacy format (bold **Tasks:** and **Comments:**) for back compat", () => {
		const input = `# Roadmap

## Legacy item
**Status:** 🟢 Done

Some description.

**Tasks:**
- [ ] \`t_old1\` Old task

**Comments:**
> [2026-01-01T00:00:00.000Z] A comment.

---
`;
		const items = parseRoadmapMarkdown(input);
		expect(items).toHaveLength(1);
		const item = items[0]!;
		expect(item.status).toBe("done");
		expect(item.description).toContain("Some description");
		expect(item.tasks).toHaveLength(1);
		expect(item.tasks[0]?.taskId).toBe("t_old1");
		expect(item.linkedTaskIds).toEqual(["t_old1"]);
		expect(item.comments).toHaveLength(1);
		// ID is auto-generated since no **ID:** line
		expect(item.id).toMatch(/^roadmap_/);
	});

	it("preserves description content that is not a subsection", () => {
		const input = `# Roadmap

## Feature with rich description
**ID:** \`roadmap_rich\`
**Status:** 🔵 Planned

This is a multi-line description.

**Multi-system impact:**
- file1.ts
- file2.ts

**Progress:** 3/7 tasks done.

### Tasks

- [ ] \`t_one\` First task

---
`;
		const items = parseRoadmapMarkdown(input);
		expect(items).toHaveLength(1);
		const item = items[0]!;
		expect(item.description).toContain("multi-line description");
		expect(item.description).toContain("Multi-system impact");
		expect(item.description).toContain("file1.ts");
		expect(item.description).toContain("Progress");
		expect(item.tasks).toHaveLength(1);
	});
});
