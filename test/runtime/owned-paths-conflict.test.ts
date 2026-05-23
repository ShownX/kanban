import { describe, expect, it } from "vitest";

import {
	dedupOwnedPaths,
	findAllOwnedPathsConflicts,
	findOwnedPathsConflicts,
	formatOwnedPathsConflict,
} from "../../src/workspace/owned-paths-conflict";

const WORKSPACE = "/tmp/kanban-ws";

describe("findOwnedPathsConflicts (pairwise)", () => {
	it("returns no conflicts when paths are disjoint", () => {
		const conflicts = findOwnedPathsConflicts(
			WORKSPACE,
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "payment", ownedPaths: ["src/payment"] },
		);
		expect(conflicts).toEqual([]);
	});

	it("flags identical paths with relationship=equal", () => {
		const conflicts = findOwnedPathsConflicts(
			WORKSPACE,
			{ id: "auth-a", ownedPaths: ["src/auth"] },
			{ id: "auth-b", ownedPaths: ["src/auth"] },
		);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]).toMatchObject({ relationship: "equal" });
	});

	it("flags parent/child overlap", () => {
		const conflicts = findOwnedPathsConflicts(
			WORKSPACE,
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "auth-login", ownedPaths: ["src/auth/login.ts"] },
		);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.relationship).toBe("left_contains_right");
	});

	it("does not match prefix-but-not-directory-boundary paths", () => {
		const conflicts = findOwnedPathsConflicts(
			WORKSPACE,
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "authentic", ownedPaths: ["src/authentic"] },
		);
		expect(conflicts).toEqual([]);
	});

	it("ignores self-claims when both sides have the same id", () => {
		const conflicts = findOwnedPathsConflicts(
			WORKSPACE,
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "auth", ownedPaths: ["src/auth"] },
		);
		expect(conflicts).toEqual([]);
	});

	it("reports every overlap pair when each claim has multiple paths", () => {
		const conflicts = findOwnedPathsConflicts(
			WORKSPACE,
			{ id: "left", ownedPaths: ["src/a", "src/b"] },
			{ id: "right", ownedPaths: ["src/a/x", "src/b/y", "src/c"] },
		);
		expect(conflicts).toHaveLength(2);
	});
});

describe("findAllOwnedPathsConflicts", () => {
	it("walks claims pairwise and surfaces every overlap", () => {
		const conflicts = findAllOwnedPathsConflicts(WORKSPACE, [
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "payment", ownedPaths: ["src/payment"] },
			{ id: "shared", ownedPaths: ["src/auth/util.ts"] },
		]);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.leftClaimId).toBe("auth");
		expect(conflicts[0]?.rightClaimId).toBe("shared");
	});

	it("returns an empty list when every claim is disjoint", () => {
		const conflicts = findAllOwnedPathsConflicts(WORKSPACE, [
			{ id: "a", ownedPaths: ["src/a"] },
			{ id: "b", ownedPaths: ["src/b"] },
			{ id: "c", ownedPaths: ["src/c"] },
		]);
		expect(conflicts).toEqual([]);
	});
});

describe("dedupOwnedPaths", () => {
	it("collapses redundant child paths that an ancestor already covers", () => {
		expect(dedupOwnedPaths(WORKSPACE, ["src/auth", "src/auth/login.ts", "src/auth/session.ts"])).toEqual([
			"src/auth",
		]);
	});

	it("removes duplicates", () => {
		expect(dedupOwnedPaths(WORKSPACE, ["src/auth", "src/auth"])).toEqual(["src/auth"]);
	});

	it("preserves disjoint paths in input order", () => {
		expect(dedupOwnedPaths(WORKSPACE, ["src/payment", "src/auth"])).toEqual(["src/payment", "src/auth"]);
	});

	it("drops empty / whitespace entries", () => {
		expect(dedupOwnedPaths(WORKSPACE, ["", "  ", "src/auth"])).toEqual(["src/auth"]);
	});

	it("collapses descendants when they appear before the ancestor", () => {
		expect(dedupOwnedPaths(WORKSPACE, ["src/auth/login.ts", "src/auth"])).toEqual(["src/auth"]);
	});
});

describe("formatOwnedPathsConflict", () => {
	it("renders parent/child overlaps with both ids", () => {
		const message = formatOwnedPathsConflict({
			leftClaimId: "auth",
			rightClaimId: "auth-login",
			leftPath: "src/auth",
			rightPath: "src/auth/login.ts",
			relationship: "left_contains_right",
		});
		expect(message).toContain("auth");
		expect(message).toContain("auth-login");
		expect(message).toContain("src/auth/login.ts");
	});
});
