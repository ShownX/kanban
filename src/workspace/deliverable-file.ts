import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/**
 * Deliverable file written by a task agent at `to_review` time.
 * Lives in the task's worktree at `.kanban/tasks/<taskId>/deliverable.md`.
 * An optional `.json` sidecar is generated from the markdown for machine use.
 */

const DELIVERABLE_DIR = ".kanban/tasks";

export function getDeliverableDirPath(worktreePath: string, taskId: string): string {
	return join(worktreePath, DELIVERABLE_DIR, taskId);
}

export function getDeliverableMdPath(worktreePath: string, taskId: string): string {
	return join(getDeliverableDirPath(worktreePath, taskId), "deliverable.md");
}

export function getDeliverableJsonPath(worktreePath: string, taskId: string): string {
	return join(getDeliverableDirPath(worktreePath, taskId), "deliverable.json");
}

// --- Schema ---

export const deliverableRequirementCheckSchema = z.object({
	requirement: z.string(),
	status: z.enum(["met", "partial", "skipped"]),
	evidence: z.string().optional(),
});
export type DeliverableRequirementCheck = z.infer<typeof deliverableRequirementCheckSchema>;

export const deliverableSchema = z.object({
	taskId: z.string(),
	roadmapItemId: z.string().optional(),
	roadmapVersion: z.number().optional(),
	agent: z.string().optional(),
	completedAt: z.string().optional(),
	summary: z.string(),
	requirementsCheck: z.array(deliverableRequirementCheckSchema).default([]),
	changedFiles: z.array(z.string()).default([]),
	openQuestions: z.array(z.string()).default([]),
});
export type Deliverable = z.infer<typeof deliverableSchema>;

// --- Reader ---

export async function readDeliverableJson(worktreePath: string, taskId: string): Promise<Deliverable | null> {
	const jsonPath = getDeliverableJsonPath(worktreePath, taskId);
	try {
		const raw = await readFile(jsonPath, "utf8");
		return deliverableSchema.parse(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function readDeliverableMd(worktreePath: string, taskId: string): Promise<string | null> {
	const mdPath = getDeliverableMdPath(worktreePath, taskId);
	try {
		return await readFile(mdPath, "utf8");
	} catch {
		return null;
	}
}

/**
 * Parse a deliverable.md into a structured Deliverable object.
 * Best-effort: extracts what it can from the markdown headings.
 */
export function parseDeliverableMd(content: string, taskId: string): Deliverable {
	let summary = "";
	let roadmapItemId: string | undefined;
	let roadmapVersion: number | undefined;
	let agent: string | undefined;
	let completedAt: string | undefined;
	const requirementsCheck: DeliverableRequirementCheck[] = [];
	const changedFiles: string[] = [];
	const openQuestions: string[] = [];

	const lines = content.split("\n");
	let currentSection = "none";

	for (const line of lines) {
		const trimmed = line.trim();

		// Metadata lines
		if (trimmed.startsWith("**Roadmap item:**")) {
			const match = trimmed.match(/`([^`]+)`/);
			if (match?.[1]) roadmapItemId = match[1];
			continue;
		}
		if (trimmed.startsWith("**Roadmap version:**")) {
			const match = trimmed.match(/(\d+)/);
			if (match?.[1]) roadmapVersion = Number.parseInt(match[1], 10);
			continue;
		}
		if (trimmed.startsWith("**Agent:**")) {
			agent = trimmed.replace(/^\*\*Agent:\*\*\s*/, "").trim() || undefined;
			continue;
		}
		if (trimmed.startsWith("**Completed:**")) {
			completedAt = trimmed.replace(/^\*\*Completed:\*\*\s*/, "").trim() || undefined;
			continue;
		}

		// Section headings
		if (trimmed.startsWith("## ")) {
			const heading = trimmed.slice(3).trim().toLowerCase();
			if (heading === "summary") {
				currentSection = "summary";
				continue;
			}
			if (heading.startsWith("requirements check") || heading.startsWith("acceptance")) {
				currentSection = "requirements";
				continue;
			}
			if (heading === "changed files") {
				currentSection = "files";
				continue;
			}
			if (heading === "open questions") {
				currentSection = "questions";
				continue;
			}
			currentSection = "other";
			continue;
		}

		// Content routing
		switch (currentSection) {
			case "summary":
				if (trimmed) summary += (summary ? " " : "") + trimmed;
				break;
			case "requirements": {
				const match = trimmed.match(/^-\s*\[([ x~])\]\s*(.+)$/);
				if (match?.[2]) {
					const status = match[1] === "x" ? "met" : match[1] === "~" ? "partial" : "skipped";
					const parts = match[2].split("—").map((s) => s.trim());
					requirementsCheck.push({
						requirement: parts[0] ?? match[2],
						status,
						evidence: parts[1] || undefined,
					});
				}
				break;
			}
			case "files":
				if (trimmed && !trimmed.startsWith("#")) changedFiles.push(trimmed.replace(/^[-*]\s*/, ""));
				break;
			case "questions":
				if (trimmed.startsWith("- ")) openQuestions.push(trimmed.slice(2));
				break;
		}
	}

	return {
		taskId,
		summary,
		...(roadmapItemId ? { roadmapItemId } : {}),
		...(roadmapVersion != null ? { roadmapVersion } : {}),
		...(agent ? { agent } : {}),
		...(completedAt ? { completedAt } : {}),
		requirementsCheck,
		changedFiles,
		openQuestions,
	};
}
