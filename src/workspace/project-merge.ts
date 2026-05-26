import { runGit } from "./git-utils";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface MergeSubtaskResult {
	success: boolean;
	/** Present when the merge failed (e.g. conflict). */
	error?: string;
	/** The worktree path used for the merge, if one was found. */
	mergedInWorktree?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WorktreeEntry {
	worktree: string;
	branch: string | null;
}

/**
 * Parse the output of `git worktree list --porcelain` into structured entries.
 */
function parseWorktreeListOutput(output: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let currentWorktree: string | null = null;
	let currentBranch: string | null = null;

	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("worktree ")) {
			if (currentWorktree !== null) {
				entries.push({ worktree: currentWorktree, branch: currentBranch });
			}
			currentWorktree = line.slice("worktree ".length);
			currentBranch = null;
		} else if (line.startsWith("branch ")) {
			// Branch line looks like: "branch refs/heads/project/user-auth"
			const ref = line.slice("branch ".length);
			currentBranch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
		}
	}

	if (currentWorktree !== null) {
		entries.push({ worktree: currentWorktree, branch: currentBranch });
	}

	return entries;
}

/**
 * Find the worktree path that has a given branch checked out.
 */
async function findWorktreeForBranch(repoPath: string, branchName: string): Promise<string | null> {
	const result = await runGit(repoPath, ["worktree", "list", "--porcelain"]);
	if (!result.ok) {
		return null;
	}

	const entries = parseWorktreeListOutput(result.stdout);
	const match = entries.find((entry) => entry.branch === branchName);
	return match?.worktree ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge a sub-task branch into its parent project branch.
 *
 * The merge is performed inside the project agent's worktree (if one exists
 * with the project branch checked out). If the project worktree cannot be
 * found, the merge is skipped — the branch can be merged later when the
 * project agent starts.
 *
 * On conflict the merge is aborted and the error is returned so both branches
 * remain intact for human resolution.
 */
export async function mergeSubtaskIntoProject(options: {
	repoPath: string;
	subtaskBranch: string;
	projectBranch: string;
}): Promise<MergeSubtaskResult> {
	const { repoPath, subtaskBranch, projectBranch } = options;

	// Verify the subtask branch exists.
	const subtaskBranchExists = await runGit(repoPath, ["rev-parse", "--verify", `refs/heads/${subtaskBranch}`]);
	if (!subtaskBranchExists.ok) {
		// Branch doesn't exist — nothing to merge (already cleaned up).
		return { success: true };
	}

	// Verify the project branch exists.
	const projectBranchExists = await runGit(repoPath, ["rev-parse", "--verify", `refs/heads/${projectBranch}`]);
	if (!projectBranchExists.ok) {
		// Project branch doesn't exist — skip (project agent hasn't started).
		return { success: true };
	}

	// Check if the subtask branch has any new commits beyond the project branch.
	const mergeBaseResult = await runGit(repoPath, ["merge-base", projectBranch, subtaskBranch]);
	if (mergeBaseResult.ok) {
		const subtaskHead = await runGit(repoPath, ["rev-parse", subtaskBranch]);
		if (subtaskHead.ok && subtaskHead.stdout === mergeBaseResult.stdout) {
			// Subtask branch has no additional commits — nothing to merge.
			return { success: true };
		}
	}

	// Find the worktree that has the project branch checked out.
	const projectWorktreePath = await findWorktreeForBranch(repoPath, projectBranch);
	if (!projectWorktreePath) {
		// No worktree has the project branch checked out. Skip the merge —
		// the branch will be merged later when the project agent starts.
		return { success: true };
	}

	// Perform the merge inside the project worktree.
	const mergeResult = await runGit(projectWorktreePath, [
		"merge",
		subtaskBranch,
		"--no-edit",
		"-m",
		`Merge subtask branch '${subtaskBranch}' into ${projectBranch}`,
	]);

	if (mergeResult.ok) {
		return {
			success: true,
			mergedInWorktree: projectWorktreePath,
		};
	}

	// Merge failed — likely a conflict. Abort the merge to leave both
	// branches intact for human resolution.
	await runGit(projectWorktreePath, ["merge", "--abort"]);

	const errorOutput = mergeResult.stderr || mergeResult.output || "Merge failed with conflicts.";
	return {
		success: false,
		error: errorOutput,
		mergedInWorktree: projectWorktreePath,
	};
}

/**
 * Delete a sub-task branch after it has been merged (or after deciding to
 * discard it).
 *
 * Tries a safe delete (`-d`) first. If the branch is not fully merged, falls
 * back to a force delete (`-D`) since the merge was already attempted.
 */
export async function cleanupSubtaskBranch(options: { repoPath: string; subtaskBranch: string }): Promise<void> {
	const { repoPath, subtaskBranch } = options;

	// Verify the branch exists before attempting to delete.
	const branchExists = await runGit(repoPath, ["rev-parse", "--verify", `refs/heads/${subtaskBranch}`]);
	if (!branchExists.ok) {
		// Already deleted — nothing to do.
		return;
	}

	// Try safe delete first (only works if fully merged).
	const safeDelete = await runGit(repoPath, ["branch", "-d", subtaskBranch]);
	if (safeDelete.ok) {
		return;
	}

	// Force delete — the merge was already attempted and either succeeded
	// or was reported as conflicted.
	await runGit(repoPath, ["branch", "-D", subtaskBranch]);
}

/**
 * Determine whether a card represents a sub-task of a project agent based on
 * its role and baseRef. Returns the derived branch names if it does.
 */
export function resolveSubtaskMergeBranches(options: {
	taskId: string;
	baseRef: string;
	role?: string;
}): { subtaskBranch: string; projectBranch: string } | null {
	const { taskId, baseRef, role } = options;

	// Project agent cards themselves should not be merged into anything.
	if (role === "project_agent") {
		return null;
	}

	// Only sub-tasks branched off a project branch need merging.
	if (!baseRef.startsWith("project/")) {
		return null;
	}

	return {
		subtaskBranch: `${baseRef}/${taskId}`,
		projectBranch: baseRef,
	};
}
