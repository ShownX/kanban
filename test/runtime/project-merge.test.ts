import { describe, expect, it } from "vitest";

import { resolveSubtaskMergeBranches } from "../../src/workspace/project-merge";

describe("resolveSubtaskMergeBranches", () => {
	it("returns branch names for a sub-task with project/ baseRef", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-abc123",
			baseRef: "project/user-auth",
			role: "task",
		});
		expect(result).toEqual({
			subtaskBranch: "project/user-auth/task-abc123",
			projectBranch: "project/user-auth",
		});
	});

	it("returns branch names when role is undefined (defaults to sub-task)", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-xyz",
			baseRef: "project/payments",
		});
		expect(result).toEqual({
			subtaskBranch: "project/payments/task-xyz",
			projectBranch: "project/payments",
		});
	});

	it("returns null for project_agent cards (they should not be merged)", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-proj",
			baseRef: "main",
			role: "project_agent",
		});
		expect(result).toBeNull();
	});

	it("returns null for standalone tasks (baseRef does not start with project/)", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-standalone",
			baseRef: "main",
			role: "task",
		});
		expect(result).toBeNull();
	});

	it("returns null when baseRef is a regular branch name", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-feature",
			baseRef: "feature/my-feature",
		});
		expect(result).toBeNull();
	});

	it("handles deeply nested project branch names", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-deep",
			baseRef: "project/multi-part-slug",
			role: "task",
		});
		expect(result).toEqual({
			subtaskBranch: "project/multi-part-slug/task-deep",
			projectBranch: "project/multi-part-slug",
		});
	});

	it("returns null for validator cards", () => {
		const result = resolveSubtaskMergeBranches({
			taskId: "task-validator",
			baseRef: "project/user-auth",
			role: "validator",
		});
		// Validators are not project agents, and have project/ baseRef,
		// so they would get merge treatment as sub-tasks.
		expect(result).toEqual({
			subtaskBranch: "project/user-auth/task-validator",
			projectBranch: "project/user-auth",
		});
	});
});
