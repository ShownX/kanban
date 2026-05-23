import { resolve } from "node:path";

import { isPathWithinRoot } from "./path-sandbox.js";

/**
 * Detect when two project agents would have overlapping ownedPaths.
 *
 * Multi-agent cooperation breaks if two agents both claim "I own
 * src/auth/" — they'll race and clobber each other. This module flags
 * those conflicts at agent-creation time so the planner can catch the
 * mistake before any work starts.
 *
 * Two ownership claims overlap when one path is a parent (or equal) to
 * the other. `src/auth/` and `src/auth/login.ts` overlap — the second
 * is contained in the first. `src/auth/` and `src/payment/` do not.
 */

export interface OwnedPathsClaim {
	/** Identifier (project-agent specSlug, card id, etc.) for diagnostic output. */
	id: string;
	/** Workspace-root-relative paths the claimant declares ownership over. */
	ownedPaths: readonly string[];
}

export interface OwnedPathsConflict {
	leftClaimId: string;
	rightClaimId: string;
	leftPath: string;
	rightPath: string;
	relationship: "equal" | "left_contains_right" | "right_contains_left";
}

/**
 * Compare two claims and return every overlap pair found.
 * Self-overlaps within a single claim's own paths are NOT reported here
 * (that's a different concern; see `dedupOwnedPaths`).
 */
export function findOwnedPathsConflicts(
	workspacePath: string,
	left: OwnedPathsClaim,
	right: OwnedPathsClaim,
): OwnedPathsConflict[] {
	if (left.id === right.id) return [];
	const root = resolve(workspacePath);
	const leftResolved = left.ownedPaths.map((path) => ({ raw: path, abs: resolve(root, path) }));
	const rightResolved = right.ownedPaths.map((path) => ({ raw: path, abs: resolve(root, path) }));

	const conflicts: OwnedPathsConflict[] = [];
	for (const leftEntry of leftResolved) {
		for (const rightEntry of rightResolved) {
			const relationship = pathRelationship(leftEntry.abs, rightEntry.abs);
			if (!relationship) continue;
			conflicts.push({
				leftClaimId: left.id,
				rightClaimId: right.id,
				leftPath: leftEntry.raw,
				rightPath: rightEntry.raw,
				relationship,
			});
		}
	}
	return conflicts;
}

/**
 * Walk a list of claims pairwise and return every conflict found.
 * Useful when the planner is about to create a new project agent and
 * wants to validate against all existing agents at once.
 */
export function findAllOwnedPathsConflicts(
	workspacePath: string,
	claims: readonly OwnedPathsClaim[],
): OwnedPathsConflict[] {
	const conflicts: OwnedPathsConflict[] = [];
	for (let i = 0; i < claims.length; i++) {
		for (let j = i + 1; j < claims.length; j++) {
			const left = claims[i];
			const right = claims[j];
			if (!left || !right) continue;
			conflicts.push(...findOwnedPathsConflicts(workspacePath, left, right));
		}
	}
	return conflicts;
}

/**
 * Drop duplicate / redundant owned paths from a single claim. Returns the
 * minimal set: when one path contains another, keeps the parent only.
 * Stable order preserves the caller's input ordering for the entries that
 * survive.
 */
export function dedupOwnedPaths(workspacePath: string, ownedPaths: readonly string[]): string[] {
	const root = resolve(workspacePath);
	const resolved = ownedPaths
		.map((raw) => ({ raw: raw.trim(), abs: raw.trim() ? resolve(root, raw.trim()) : "" }))
		.filter((entry) => entry.raw.length > 0);
	const survivors: typeof resolved = [];
	for (const entry of resolved) {
		// Skip if any already-kept entry is an ancestor (or equal).
		const dominatedBy = survivors.find((kept) => isPathWithinRoot(kept.abs, entry.abs));
		if (dominatedBy) continue;
		// Drop any kept entries that are descendants of this new one.
		for (let i = survivors.length - 1; i >= 0; i--) {
			const kept = survivors[i];
			if (kept && isPathWithinRoot(entry.abs, kept.abs) && kept.abs !== entry.abs) {
				survivors.splice(i, 1);
			}
		}
		survivors.push(entry);
	}
	return survivors.map((entry) => entry.raw);
}

function pathRelationship(left: string, right: string): OwnedPathsConflict["relationship"] | null {
	if (left === right) return "equal";
	if (isPathWithinRoot(left, right)) return "left_contains_right";
	if (isPathWithinRoot(right, left)) return "right_contains_left";
	return null;
}

/**
 * Format a conflict for human/agent display.
 */
export function formatOwnedPathsConflict(conflict: OwnedPathsConflict): string {
	switch (conflict.relationship) {
		case "equal":
			return `Both "${conflict.leftClaimId}" and "${conflict.rightClaimId}" claim "${conflict.leftPath}".`;
		case "left_contains_right":
			return `"${conflict.leftClaimId}" claims "${conflict.leftPath}" which contains "${conflict.rightClaimId}"'s "${conflict.rightPath}".`;
		case "right_contains_left":
			return `"${conflict.rightClaimId}" claims "${conflict.rightPath}" which contains "${conflict.leftClaimId}"'s "${conflict.leftPath}".`;
	}
}
