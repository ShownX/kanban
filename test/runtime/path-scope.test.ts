import { describe, expect, it } from "vitest";

import {
	assertPathInScope,
	checkPathInScope,
	formatOwnedPaths,
	PathScopeViolationError,
	resolveOwnedPathRoots,
} from "../../src/workspace/path-scope";

const WORKSPACE = "/tmp/kanban-ws";

describe("checkPathInScope", () => {
	it("returns null when the candidate is inside an owned path", () => {
		expect(checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth/"] }, "src/auth/login.ts")).toBeNull();
	});

	it("returns null for an exact owned-path match", () => {
		expect(checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] }, "src/auth")).toBeNull();
	});

	it("flags paths outside the workspace as outside_workspace", () => {
		const violation = checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] }, "../etc/passwd");
		expect(violation?.reason).toBe("outside_workspace");
	});

	it("flags absolute escape paths as outside_workspace", () => {
		const violation = checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] }, "/etc/passwd");
		expect(violation?.reason).toBe("outside_workspace");
	});

	it("flags in-workspace paths outside the agent's owned scope", () => {
		const violation = checkPathInScope(
			{ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] },
			"src/payment/checkout.ts",
		);
		expect(violation?.reason).toBe("outside_owned_paths");
		expect(violation?.allowedRoots).toEqual([`${WORKSPACE}/src/auth`]);
	});

	it("refuses to act when no scope is declared", () => {
		const violation = checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: [] }, "src/auth/login.ts");
		expect(violation?.reason).toBe("no_scope_declared");
	});

	it("ignores empty / whitespace owned-path entries", () => {
		expect(
			checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["", "  ", "src/auth/"] }, "src/auth/login.ts"),
		).toBeNull();
	});

	it("treats a trailing slash and a non-trailing-slash root as equivalent", () => {
		const a = checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] }, "src/auth/x.ts");
		const b = checkPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth/"] }, "src/auth/x.ts");
		expect(a).toBeNull();
		expect(b).toBeNull();
	});

	it("does not match paths that share a prefix but not a directory boundary", () => {
		// "src/authentic/..." is NOT inside "src/auth/" — common bug to avoid.
		const violation = checkPathInScope(
			{ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] },
			"src/authentic/foo.ts",
		);
		expect(violation?.reason).toBe("outside_owned_paths");
	});
});

describe("assertPathInScope", () => {
	it("throws PathScopeViolationError on out-of-scope writes", () => {
		expect(() =>
			assertPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] }, "src/payment/x.ts"),
		).toThrow(PathScopeViolationError);
	});

	it("does not throw when the path is in scope", () => {
		expect(() =>
			assertPathInScope({ workspacePath: WORKSPACE, ownedPaths: ["src/auth"] }, "src/auth/x.ts"),
		).not.toThrow();
	});
});

describe("resolveOwnedPathRoots", () => {
	it("drops owned paths that escape the workspace root", () => {
		const roots = resolveOwnedPathRoots({
			workspacePath: WORKSPACE,
			ownedPaths: ["src/auth", "../escape", "../../etc"],
		});
		expect(roots).toEqual([`${WORKSPACE}/src/auth`]);
	});

	it("dedups owned paths that resolve to the same absolute path", () => {
		const roots = resolveOwnedPathRoots({
			workspacePath: WORKSPACE,
			ownedPaths: ["src/auth", "src/auth/", "src/./auth"],
		});
		expect(roots).toEqual([`${WORKSPACE}/src/auth`]);
	});
});

describe("formatOwnedPaths", () => {
	it("renders absolute paths with forward slashes", () => {
		const formatted = formatOwnedPaths(WORKSPACE, ["src/auth", "src/types/auth.ts"]);
		expect(formatted).toBe(`${WORKSPACE}/src/auth, ${WORKSPACE}/src/types/auth.ts`);
	});

	it("returns a placeholder when no paths are declared", () => {
		expect(formatOwnedPaths(WORKSPACE, [])).toBe("(no owned paths declared)");
	});
});
