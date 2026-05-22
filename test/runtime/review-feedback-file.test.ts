import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	clearReviewFeedback,
	getReviewFeedbackPath,
	readReviewFeedback,
	writeReviewFeedback,
} from "../../src/workspace/review-feedback-file";

function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "kanban-review-feedback-test-"));
	return fn(root).finally(() => {
		rmSync(root, { recursive: true, force: true });
	});
}

describe("review-feedback file", () => {
	it("writes, reads, and clears feedback round-trip", async () => {
		await withTempWorkspace(async (workspacePath) => {
			await writeReviewFeedback(workspacePath, "t_x", {
				outcome: "rejected",
				roadmapItemId: "roadmap_auth01",
				reviewedAt: "2026-05-22T12:00:00.000Z",
				note: "Login fails on Safari — please add a regression test.",
			});

			const filePath = getReviewFeedbackPath(workspacePath, "t_x");
			expect(existsSync(filePath)).toBe(true);

			const { content, feedback } = await readReviewFeedback(workspacePath, "t_x");
			expect(content).not.toBeNull();
			expect(feedback).toMatchObject({
				outcome: "rejected",
				roadmapItemId: "roadmap_auth01",
				reviewedAt: "2026-05-22T12:00:00.000Z",
				note: "Login fails on Safari — please add a regression test.",
			});

			await clearReviewFeedback(workspacePath, "t_x");
			expect(existsSync(filePath)).toBe(false);

			const after = await readReviewFeedback(workspacePath, "t_x");
			expect(after.feedback).toBeNull();
			expect(after.content).toBeNull();
		});
	});

	it("returns nulls when no feedback file exists", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const result = await readReviewFeedback(workspacePath, "t_missing");
			expect(result).toEqual({ content: null, feedback: null });
		});
	});

	it("clear is a no-op when the file does not exist", async () => {
		await withTempWorkspace(async (workspacePath) => {
			await expect(clearReviewFeedback(workspacePath, "t_nope")).resolves.toBeUndefined();
		});
	});

	it("preserves multi-paragraph notes", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const longNote = "First paragraph.\n\nSecond paragraph with details.\n- bullet 1\n- bullet 2";
			await writeReviewFeedback(workspacePath, "t_long", {
				outcome: "escalated",
				roadmapItemId: "roadmap_x",
				reviewedAt: "2026-05-22T13:00:00.000Z",
				note: longNote,
			});
			const { feedback } = await readReviewFeedback(workspacePath, "t_long");
			expect(feedback?.note).toContain("First paragraph.");
			expect(feedback?.note).toContain("Second paragraph");
			expect(feedback?.note).toContain("bullet 2");
		});
	});
});
