import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { runGit } from "./git-utils";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateProjectPrOptions {
	workspacePath: string;
	projectBranch: string;
	baseBranch: string;
	title: string;
	specSlug: string;
	roadmapItemId: string;
	taskId: string;
	/** Titles of completed sub-tasks for the PR body. */
	completedSubtaskTitles?: string[];
}

export interface CreateProjectPrResult {
	success: boolean;
	prUrl?: string;
	prNumber?: number;
	error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `gh` CLI is available on the PATH.
 */
async function isGhCliAvailable(): Promise<boolean> {
	try {
		await execFileAsync("gh", ["--version"], { encoding: "utf8" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Count how many commits the project branch is ahead of the base branch.
 * Returns 0 if the branch is not ahead or an error occurs.
 */
async function countAheadCommits(repoPath: string, baseBranch: string, projectBranch: string): Promise<number> {
	const result = await runGit(repoPath, ["rev-list", "--count", `${baseBranch}..${projectBranch}`]);
	if (!result.ok) {
		return 0;
	}
	const count = Number.parseInt(result.stdout, 10);
	return Number.isFinite(count) ? count : 0;
}

/**
 * Read the deliverable.md summary for the project (if it exists).
 */
async function readDeliverableSummary(workspacePath: string, taskId: string): Promise<string | null> {
	const mdPath = join(workspacePath, ".kanban", "tasks", taskId, "deliverable.md");
	try {
		const content = await readFile(mdPath, "utf8");
		// Extract just the summary section
		const lines = content.split("\n");
		let inSummary = false;
		const summaryLines: string[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.toLowerCase() === "## summary") {
				inSummary = true;
				continue;
			}
			if (inSummary && trimmed.startsWith("## ")) {
				break;
			}
			if (inSummary && trimmed) {
				summaryLines.push(trimmed);
			}
		}
		return summaryLines.length > 0 ? summaryLines.join("\n") : null;
	} catch {
		return null;
	}
}

/**
 * Build the PR body markdown.
 */
function buildPrBody(options: {
	specSlug: string;
	roadmapItemId: string;
	deliverableSummary: string | null;
	completedSubtaskTitles: string[];
}): string {
	const { specSlug, roadmapItemId, deliverableSummary, completedSubtaskTitles } = options;
	const sections: string[] = [];

	// Summary
	sections.push("## Summary");
	if (deliverableSummary) {
		sections.push(deliverableSummary);
	} else {
		sections.push(`Project implementation for roadmap item \`${roadmapItemId}\`.`);
	}
	sections.push("");

	// Roadmap reference
	sections.push("## Roadmap");
	sections.push(`- **Roadmap item:** \`${roadmapItemId}\``);
	sections.push(`- **Spec:** \`specs/${specSlug}/\``);
	sections.push("");

	// Completed sub-tasks
	if (completedSubtaskTitles.length > 0) {
		sections.push("## Completed sub-tasks");
		for (const title of completedSubtaskTitles) {
			sections.push(`- [x] ${title}`);
		}
		sections.push("");
	}

	return sections.join("\n");
}

/**
 * Parse a PR URL from `gh pr create` output.
 * The `gh` CLI typically prints the URL as the last line.
 */
function parsePrUrlFromOutput(output: string): { url: string; number: number } | null {
	const lines = output.trim().split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim();
		if (!line) continue;
		// Match URLs like https://github.com/<owner>/<repo>/pull/<number>
		const match = line.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
		if (match?.[1]) {
			return { url: line, number: Number.parseInt(match[1], 10) };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Create a GitHub pull request from a project branch into the base branch.
 *
 * Steps:
 * 1. Verify the project branch has commits ahead of base.
 * 2. Push the project branch to the remote.
 * 3. Generate a descriptive PR body.
 * 4. Create the PR via `gh pr create`.
 */
export async function createProjectPr(options: CreateProjectPrOptions): Promise<CreateProjectPrResult> {
	const {
		workspacePath,
		projectBranch,
		baseBranch,
		title,
		specSlug,
		roadmapItemId,
		taskId,
		completedSubtaskTitles = [],
	} = options;

	// 1. Verify gh CLI is available
	if (!(await isGhCliAvailable())) {
		return {
			success: false,
			error: "The `gh` CLI is not installed or not in PATH. Install it from https://cli.github.com/ to create pull requests.",
		};
	}

	// 2. Verify the project branch exists
	const branchExists = await runGit(workspacePath, ["rev-parse", "--verify", `refs/heads/${projectBranch}`]);
	if (!branchExists.ok) {
		return {
			success: false,
			error: `Project branch "${projectBranch}" does not exist.`,
		};
	}

	// 3. Verify the base branch exists (local or remote)
	const baseLocalExists = await runGit(workspacePath, ["rev-parse", "--verify", `refs/heads/${baseBranch}`]);
	const baseRemoteExists = await runGit(workspacePath, ["rev-parse", "--verify", `refs/remotes/origin/${baseBranch}`]);
	if (!baseLocalExists.ok && !baseRemoteExists.ok) {
		return {
			success: false,
			error: `Base branch "${baseBranch}" does not exist locally or on the remote.`,
		};
	}

	// 4. Check if project branch has commits ahead of base
	const aheadCount = await countAheadCommits(workspacePath, baseBranch, projectBranch);
	if (aheadCount === 0) {
		return {
			success: false,
			error: `Project branch "${projectBranch}" has no commits ahead of "${baseBranch}". Nothing to create a PR for.`,
		};
	}

	// 5. Push the project branch to remote
	const pushResult = await runGit(workspacePath, ["push", "-u", "origin", projectBranch]);
	if (!pushResult.ok) {
		// Check for missing remote
		const remoteResult = await runGit(workspacePath, ["remote", "get-url", "origin"]);
		if (!remoteResult.ok) {
			return {
				success: false,
				error: "No 'origin' remote configured. Cannot push branch or create PR.",
			};
		}
		return {
			success: false,
			error: `Failed to push branch "${projectBranch}" to origin: ${pushResult.stderr || pushResult.output}`,
		};
	}

	// 6. Generate PR body
	const deliverableSummary = await readDeliverableSummary(workspacePath, taskId);
	const body = buildPrBody({
		specSlug,
		roadmapItemId,
		deliverableSummary,
		completedSubtaskTitles,
	});

	// 7. Create the PR via gh CLI
	try {
		const { stdout, stderr } = await execFileAsync(
			"gh",
			["pr", "create", "--base", baseBranch, "--head", projectBranch, "--title", title, "--body", body],
			{
				cwd: workspacePath,
				encoding: "utf8",
			},
		);

		const combinedOutput = [stdout, stderr].filter(Boolean).join("\n");
		const parsed = parsePrUrlFromOutput(combinedOutput);
		if (parsed) {
			return {
				success: true,
				prUrl: parsed.url,
				prNumber: parsed.number,
			};
		}

		// gh succeeded but we couldn't parse the URL — still a success
		return {
			success: true,
			prUrl: stdout.trim() || undefined,
		};
	} catch (error) {
		const candidate = error as { stderr?: string; stdout?: string; message?: string };
		const stderr = String(candidate.stderr ?? "").trim();
		const message = String(candidate.message ?? "").trim();

		// Detect "already exists" errors gracefully
		if (stderr.includes("already exists") || message.includes("already exists")) {
			return {
				success: false,
				error: `A pull request for "${projectBranch}" already exists. ${stderr || message}`,
			};
		}

		return {
			success: false,
			error: `Failed to create pull request: ${stderr || message}`,
		};
	}
}
