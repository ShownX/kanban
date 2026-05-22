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

/**
 * A single job/work item performed by the execution agent. Captures what the
 * agent actually did (not just the spec requirements). Surfaces in the
 * deliverable-validation panel so reviewers can see the trail of work.
 */
export const deliverableJobSchema = z.object({
	title: z.string(),
	status: z.enum(["done", "partial", "skipped", "failed"]).default("done"),
	detail: z.string().optional(),
});
export type DeliverableJob = z.infer<typeof deliverableJobSchema>;

export const deliverableWorkSummarySchema = z.object({
	jobs: z.array(deliverableJobSchema).default([]),
	commands: z.array(z.string()).default([]),
	durationMs: z.number().optional(),
	notes: z.string().optional(),
});
export type DeliverableWorkSummary = z.infer<typeof deliverableWorkSummarySchema>;

export const deliverableSchema = z.object({
	taskId: z.string(),
	roadmapItemId: z.string().optional(),
	roadmapVersion: z.number().optional(),
	agent: z.string().optional(),
	completedAt: z.string().optional(),
	summary: z.string(),
	workSummary: deliverableWorkSummarySchema.optional(),
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
	const jobs: DeliverableJob[] = [];
	const commands: string[] = [];
	let workNotes = "";
	let workDurationMs: number | undefined;
	let sawWorkSection = false;

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
		if (trimmed.startsWith("**Duration:**")) {
			const raw = trimmed.replace(/^\*\*Duration:\*\*\s*/, "").trim();
			const ms = parseDurationToMs(raw);
			if (ms != null) workDurationMs = ms;
			continue;
		}

		// Section headings
		if (trimmed.startsWith("## ")) {
			const heading = trimmed.slice(3).trim().toLowerCase();
			if (heading === "summary") {
				currentSection = "summary";
				continue;
			}
			if (heading.startsWith("work summary") || heading === "work" || heading === "jobs") {
				currentSection = "work";
				sawWorkSection = true;
				continue;
			}
			if (heading === "commands" || heading === "commands run") {
				currentSection = "commands";
				sawWorkSection = true;
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
			case "work": {
				const jobMatch = trimmed.match(/^-\s*\[([ x~!])\]\s*(.+)$/);
				if (jobMatch?.[2]) {
					const flag = jobMatch[1];
					const status: DeliverableJob["status"] =
						flag === "x" ? "done" : flag === "~" ? "partial" : flag === "!" ? "failed" : "skipped";
					const parts = jobMatch[2].split("—").map((s) => s.trim());
					jobs.push({
						title: parts[0] ?? jobMatch[2],
						status,
						...(parts[1] ? { detail: parts[1] } : {}),
					});
				} else if (trimmed.startsWith("- ")) {
					jobs.push({ title: trimmed.slice(2), status: "done" });
				} else if (trimmed) {
					workNotes += (workNotes ? " " : "") + trimmed;
				}
				break;
			}
			case "commands":
				if (trimmed.startsWith("```")) break;
				if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
					commands.push(trimmed.slice(2).replace(/^`|`$/g, ""));
				} else if (trimmed && !trimmed.startsWith("#")) {
					commands.push(trimmed.replace(/^`|`$/g, ""));
				}
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

	const workSummary: DeliverableWorkSummary | undefined = sawWorkSection
		? {
				jobs,
				commands,
				...(workDurationMs != null ? { durationMs: workDurationMs } : {}),
				...(workNotes ? { notes: workNotes } : {}),
			}
		: undefined;

	return {
		taskId,
		summary,
		...(roadmapItemId ? { roadmapItemId } : {}),
		...(roadmapVersion != null ? { roadmapVersion } : {}),
		...(agent ? { agent } : {}),
		...(completedAt ? { completedAt } : {}),
		...(workSummary ? { workSummary } : {}),
		requirementsCheck,
		changedFiles,
		openQuestions,
	};
}

function parseDurationToMs(raw: string): number | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	// Match all <number><unit> tuples; e.g. "2m 30s" → [["2","m"], ["30","s"]].
	const partRegex = /(\d+(?:\.\d+)?)\s*(ms|s|m|min|minutes|h|hours)?/gi;
	let total = 0;
	let matched = false;
	for (let m = partRegex.exec(trimmed); m !== null; m = partRegex.exec(trimmed)) {
		matched = true;
		const value = Number.parseFloat(m[1] ?? "");
		if (!Number.isFinite(value)) return null;
		const unit = (m[2] ?? "ms").toLowerCase();
		total += unitToMs(value, unit);
	}
	if (!matched) return null;
	return Math.round(total);
}

function unitToMs(value: number, unit: string): number {
	switch (unit) {
		case "ms":
			return value;
		case "s":
			return value * 1000;
		case "m":
		case "min":
		case "minutes":
			return value * 60_000;
		case "h":
		case "hours":
			return value * 3_600_000;
		default:
			return value;
	}
}
