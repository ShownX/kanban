import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

/**
 * Review feedback written by the PM when a validation is rejected or
 * escalated. Lives at `.kanban/tasks/<taskId>/review-feedback.md` so the task
 * agent can read it on the next run and address the concerns.
 */

const REVIEW_FEEDBACK_FILENAME = "review-feedback.md";

export const reviewFeedbackSchema = z.object({
	outcome: z.enum(["rejected", "escalated"]),
	roadmapItemId: z.string(),
	reviewedAt: z.string(),
	note: z.string().optional(),
});
export type ReviewFeedback = z.infer<typeof reviewFeedbackSchema>;

export function getReviewFeedbackPath(workspacePath: string, taskId: string): string {
	return join(workspacePath, ".kanban", "tasks", taskId, REVIEW_FEEDBACK_FILENAME);
}

export async function writeReviewFeedback(
	workspacePath: string,
	taskId: string,
	feedback: ReviewFeedback,
): Promise<void> {
	const filePath = getReviewFeedbackPath(workspacePath, taskId);
	await mkdir(dirname(filePath), { recursive: true });
	const content = serializeReviewFeedback(taskId, feedback);
	await writeFile(filePath, content, "utf8");
}

export async function readReviewFeedback(
	workspacePath: string,
	taskId: string,
): Promise<{ content: string | null; feedback: ReviewFeedback | null }> {
	const filePath = getReviewFeedbackPath(workspacePath, taskId);
	let content: string;
	try {
		content = await readFile(filePath, "utf8");
	} catch {
		return { content: null, feedback: null };
	}
	const feedback = parseReviewFeedback(content);
	return { content, feedback };
}

const OUTCOME_LABEL: Record<ReviewFeedback["outcome"], string> = {
	rejected: "Rejected",
	escalated: "Escalated",
};

function serializeReviewFeedback(taskId: string, feedback: ReviewFeedback): string {
	const lines: string[] = [];
	lines.push(`# Review feedback for ${taskId}`);
	lines.push("");
	lines.push(`**Outcome:** ${OUTCOME_LABEL[feedback.outcome]}`);
	lines.push(`**Roadmap item:** \`${feedback.roadmapItemId}\``);
	lines.push(`**Reviewed at:** ${feedback.reviewedAt}`);
	lines.push("");
	if (feedback.note) {
		lines.push("## Reviewer note");
		lines.push("");
		lines.push(feedback.note);
		lines.push("");
	}
	lines.push("## What to do");
	lines.push("");
	lines.push(
		feedback.outcome === "rejected"
			? "Address the reviewer's concerns above, update the deliverable.md, and request validation again."
			: "This task has been escalated for human review. Pause work on this card and wait for further direction unless the reviewer resolves it.",
	);
	lines.push("");
	return lines.join("\n");
}

function parseReviewFeedback(content: string): ReviewFeedback | null {
	const lines = content.split("\n");
	let outcome: ReviewFeedback["outcome"] | null = null;
	let roadmapItemId = "";
	let reviewedAt = "";
	let note = "";
	let inNote = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.startsWith("**Outcome:**")) {
			const raw = line.replace(/^\*\*Outcome:\*\*\s*/, "").toLowerCase();
			if (raw === "rejected") outcome = "rejected";
			else if (raw === "escalated") outcome = "escalated";
			continue;
		}
		if (line.startsWith("**Roadmap item:**")) {
			const match = line.match(/`([^`]+)`/);
			if (match?.[1]) roadmapItemId = match[1];
			continue;
		}
		if (line.startsWith("**Reviewed at:**")) {
			reviewedAt = line.replace(/^\*\*Reviewed at:\*\*\s*/, "").trim();
			continue;
		}
		if (line === "## Reviewer note") {
			inNote = true;
			continue;
		}
		if (line.startsWith("## ") && line !== "## Reviewer note") {
			inNote = false;
			continue;
		}
		if (inNote && line) {
			note += (note ? "\n" : "") + rawLine;
		}
	}

	if (!outcome || !roadmapItemId || !reviewedAt) return null;
	return {
		outcome,
		roadmapItemId,
		reviewedAt,
		...(note.trim() ? { note: note.trim() } : {}),
	};
}
