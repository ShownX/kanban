import { join, resolve } from "node:path";

import { isPathWithinRoot } from "./path-sandbox.js";

/**
 * Path-scope guard for multi-agent cooperation.
 *
 * Each project agent declares a list of `ownedPaths` (relative to the
 * workspace root). Before an agent edits a file, it should call
 * `assertPathInScope` to fail fast if the path falls outside its scope —
 * this catches bugs at the call site, instead of waiting for the
 * scope-compliance validator check after the fact.
 *
 * The helpers here also defend against the obvious escape vectors:
 *   - `..` traversal in the candidate path
 *   - Absolute candidate paths that escape the workspace root
 *   - Owned paths that themselves try to escape the workspace
 *
 * Symlink resolution (a real-target outside the scope) is intentionally NOT
 * resolved here, because doing so would require a filesystem read on the
 * critical path. The validator check still fires after the fact and the
 * agents are run inside per-task git worktrees that limit blast radius.
 */

export interface PathScopeContext {
	/** Absolute path to the workspace root. */
	workspacePath: string;
	/** Owned-paths declared on the project agent (workspace-root-relative). */
	ownedPaths: readonly string[];
}

export interface PathScopeViolation {
	candidatePath: string;
	resolvedCandidate: string;
	reason: "outside_workspace" | "outside_owned_paths" | "no_scope_declared";
	allowedRoots: readonly string[];
}

/**
 * Resolve declared owned paths to absolute paths relative to the workspace
 * root. Filters out empty/whitespace entries. Owned paths that themselves
 * escape the workspace are silently dropped — they're never a useful policy.
 */
export function resolveOwnedPathRoots(context: PathScopeContext): string[] {
	const workspaceRoot = resolve(context.workspacePath);
	const seen = new Set<string>();
	const roots: string[] = [];
	for (const owned of context.ownedPaths) {
		const trimmed = owned.trim();
		if (!trimmed) continue;
		const resolved = resolve(workspaceRoot, trimmed);
		if (!isPathWithinRoot(workspaceRoot, resolved)) continue;
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		roots.push(resolved);
	}
	return roots;
}

/**
 * Returns null when the path is in scope, otherwise a violation describing
 * what went wrong. Callers can either throw on violations (`assertPathInScope`)
 * or surface them as warnings (e.g., the validator's scope_compliance check).
 */
export function checkPathInScope(context: PathScopeContext, candidatePath: string): PathScopeViolation | null {
	const workspaceRoot = resolve(context.workspacePath);
	const resolvedCandidate = resolve(workspaceRoot, candidatePath);
	if (!isPathWithinRoot(workspaceRoot, resolvedCandidate)) {
		return {
			candidatePath,
			resolvedCandidate,
			reason: "outside_workspace",
			allowedRoots: [workspaceRoot],
		};
	}
	const allowedRoots = resolveOwnedPathRoots(context);
	if (allowedRoots.length === 0) {
		return {
			candidatePath,
			resolvedCandidate,
			reason: "no_scope_declared",
			allowedRoots: [],
		};
	}
	for (const root of allowedRoots) {
		if (isPathWithinRoot(root, resolvedCandidate)) {
			return null;
		}
	}
	return {
		candidatePath,
		resolvedCandidate,
		reason: "outside_owned_paths",
		allowedRoots,
	};
}

/**
 * Like `checkPathInScope` but throws a structured error on violation. Use
 * this in agent-side code paths where any out-of-scope write is a bug.
 */
export function assertPathInScope(context: PathScopeContext, candidatePath: string): void {
	const violation = checkPathInScope(context, candidatePath);
	if (violation) {
		throw new PathScopeViolationError(violation);
	}
}

export class PathScopeViolationError extends Error {
	readonly violation: PathScopeViolation;

	constructor(violation: PathScopeViolation) {
		super(formatViolation(violation));
		this.name = "PathScopeViolationError";
		this.violation = violation;
	}
}

function formatViolation(violation: PathScopeViolation): string {
	switch (violation.reason) {
		case "outside_workspace":
			return `Path "${violation.candidatePath}" resolves to "${violation.resolvedCandidate}" which escapes the workspace root.`;
		case "no_scope_declared":
			return `Path "${violation.candidatePath}" cannot be checked: no ownedPaths declared on this agent. Refusing to act without explicit scope.`;
		case "outside_owned_paths": {
			const list = violation.allowedRoots.length > 0 ? violation.allowedRoots.join(", ") : "(empty)";
			return `Path "${violation.candidatePath}" is outside this agent's owned paths. Allowed roots: ${list}.`;
		}
	}
}

/**
 * Pretty-print an owned-paths spec relative to the workspace for diagnostic
 * messages. Always uses forward slashes for readability.
 */
export function formatOwnedPaths(workspacePath: string, ownedPaths: readonly string[]): string {
	if (ownedPaths.length === 0) return "(no owned paths declared)";
	const root = resolve(workspacePath);
	return ownedPaths
		.map((owned) => {
			const trimmed = owned.trim();
			if (!trimmed) return null;
			return join(root, trimmed).replace(/\\/g, "/");
		})
		.filter((value): value is string => value !== null)
		.join(", ");
}
