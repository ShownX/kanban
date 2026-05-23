import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	getLatestValidationsPerTask,
	getTaskValidationHistory,
	recordValidationResult,
	reviewValidation,
} from "../../src/workspace/validation-lifecycle";
import { serializeValidationReport, type ValidationReport } from "../../src/workspace/validator";

function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "kanban-validation-lifecycle-"));
	return fn(root).finally(() => {
		rmSync(root, { recursive: true, force: true });
	});
}

const baseReport: ValidationReport = {
	taskId: "t_login01",
	specSlug: "user-auth",
	roadmapItemId: "roadmap_auth01",
	result: "needs_review",
	validatedAt: "2026-05-22T12:00:00.000Z",
	checks: [{ check: "scope_compliance", status: "needs_review", details: "OK" }],
	summary: "PM review needed.",
	reviews: [],
};

function seedReport(workspacePath: string, report: ValidationReport): void {
	const taskDir = join(workspacePath, ".kanban", "tasks", report.taskId);
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(taskDir, "validation-report.md"), serializeValidationReport(report), "utf8");
}

describe("getTaskValidationHistory", () => {
	it("returns an empty list when no validations recorded", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const entries = await getTaskValidationHistory(workspacePath, "t_missing");
			expect(entries).toEqual([]);
		});
	});

	it("returns roadmap-state entries with reviewer note + timestamp", async () => {
		await withTempWorkspace(async (workspacePath) => {
			seedReport(workspacePath, baseReport);
			await recordValidationResult(
				workspacePath,
				baseReport.roadmapItemId,
				baseReport.taskId,
				baseReport.result,
				baseReport.validatedAt,
			);
			await reviewValidation(
				workspacePath,
				baseReport.roadmapItemId,
				baseReport.taskId,
				"rejected",
				"Login fails on Safari.",
			);

			const entries = await getTaskValidationHistory(workspacePath, baseReport.taskId);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({
				reportResult: "needs_review",
				validatedAt: baseReport.validatedAt,
				reviewed: true,
				reviewOutcome: "rejected",
				reviewNote: "Login fails on Safari.",
			});
			expect(entries[0]?.reviewedAt).toBeTruthy();
		});
	});

	it("merges report-file reviews with no roadmap-state entries (clone scenario)", async () => {
		await withTempWorkspace(async (workspacePath) => {
			// Simulate a freshly cloned workspace: report file has reviews,
			// but roadmap-state.json is missing.
			const reportWithReviews: ValidationReport = {
				...baseReport,
				reviews: [
					{
						outcome: "rejected",
						reviewedAt: "2026-05-22T13:00:00.000Z",
						note: "Missing test for SSO path.",
					},
					{
						outcome: "accepted",
						reviewedAt: "2026-05-22T15:30:00.000Z",
					},
				],
			};
			// Build the markdown by re-serializing the base then appending
			// reviews as the production code would.
			const taskDir = join(workspacePath, ".kanban", "tasks", reportWithReviews.taskId);
			mkdirSync(taskDir, { recursive: true });
			const baseSerialized = serializeValidationReport(baseReport);
			const reviewBlock = [
				"",
				"## Reviews",
				"",
				"### Rejected — 2026-05-22T13:00:00.000Z",
				"",
				"Missing test for SSO path.",
				"",
				"### Accepted — 2026-05-22T15:30:00.000Z",
				"",
			].join("\n");
			writeFileSync(join(taskDir, "validation-report.md"), `${baseSerialized.trimEnd()}\n${reviewBlock}\n`, "utf8");

			const entries = await getTaskValidationHistory(workspacePath, reportWithReviews.taskId);
			expect(entries).toHaveLength(2);
			expect(entries.map((e) => e.reviewOutcome)).toEqual(["accepted", "rejected"]);
			expect(entries[0]?.reviewedAt).toBe("2026-05-22T15:30:00.000Z");
			expect(entries[1]?.reviewNote).toBe("Missing test for SSO path.");
		});
	});

	it("does not double-count when both sources have the same review", async () => {
		await withTempWorkspace(async (workspacePath) => {
			seedReport(workspacePath, baseReport);
			await recordValidationResult(
				workspacePath,
				baseReport.roadmapItemId,
				baseReport.taskId,
				baseReport.result,
				baseReport.validatedAt,
			);
			// reviewValidation writes both to roadmap-state.json AND to the report
			// file via appendReviewToReportFile. Verify the merge dedups.
			await reviewValidation(workspacePath, baseReport.roadmapItemId, baseReport.taskId, "accepted", "All good.");

			const entries = await getTaskValidationHistory(workspacePath, baseReport.taskId);
			expect(entries).toHaveLength(1);
		});
	});
});

describe("experiment_logs check", () => {
	it("flags logs containing FAIL/ERROR markers as needs_review", async () => {
		const { validateDeliverable } = await import("../../src/workspace/validator");
		await withTempWorkspace(async (workspacePath) => {
			// Seed a deliverable.md so other checks have something to inspect.
			const taskDir = join(workspacePath, ".kanban", "tasks", "t_log_fail");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(
				join(taskDir, "deliverable.md"),
				`# Task t_log_fail\n\n**Roadmap item:** \`roadmap_x\`\n\n## Summary\nDid the thing.\n`,
				"utf8",
			);
			const expDir = join(taskDir, "experiments");
			mkdirSync(expDir, { recursive: true });
			writeFileSync(join(expDir, "good.log"), "tests passed\n", "utf8");
			writeFileSync(join(expDir, "bad.log"), "running migration\nERROR: column foo does not exist\n", "utf8");

			const report = await validateDeliverable({
				workspacePath,
				taskId: "t_log_fail",
				specSlug: "user-auth",
				roadmapItemId: "roadmap_x",
				ownedPaths: [],
			});
			const experimentCheck = report.checks.find((c) => c.check === "experiment_logs");
			expect(experimentCheck?.status).toBe("needs_review");
			expect(experimentCheck?.details).toContain("bad.log");
		});
	});

	it("passes when no experiment logs exist", async () => {
		const { validateDeliverable } = await import("../../src/workspace/validator");
		await withTempWorkspace(async (workspacePath) => {
			const taskDir = join(workspacePath, ".kanban", "tasks", "t_no_logs");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(
				join(taskDir, "deliverable.md"),
				`# Task t_no_logs\n\n**Roadmap item:** \`roadmap_x\`\n\n## Summary\nDid the thing.\n`,
				"utf8",
			);
			const report = await validateDeliverable({
				workspacePath,
				taskId: "t_no_logs",
				specSlug: "user-auth",
				roadmapItemId: "roadmap_x",
				ownedPaths: [],
			});
			const experimentCheck = report.checks.find((c) => c.check === "experiment_logs");
			expect(experimentCheck?.status).toBe("pass");
			expect(experimentCheck?.details).toContain("No experiment logs");
		});
	});
});

describe("getLatestValidationsPerTask", () => {
	it("returns an empty array when no validations recorded", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const entries = await getLatestValidationsPerTask(workspacePath);
			expect(entries).toEqual([]);
		});
	});

	it("returns one entry per task across multiple roadmap items", async () => {
		await withTempWorkspace(async (workspacePath) => {
			seedReport(workspacePath, baseReport);
			seedReport(workspacePath, { ...baseReport, taskId: "t_signup" });
			await recordValidationResult(
				workspacePath,
				"roadmap_auth01",
				baseReport.taskId,
				"needs_review",
				baseReport.validatedAt,
			);
			await recordValidationResult(workspacePath, "roadmap_auth01", "t_signup", "fail", "2026-05-22T12:30:00.000Z");

			const entries = await getLatestValidationsPerTask(workspacePath);
			expect(entries).toHaveLength(2);
			const byTask = Object.fromEntries(entries.map((e) => [e.taskId, e]));
			expect(byTask[baseReport.taskId]?.reportResult).toBe("needs_review");
			expect(byTask.t_signup?.reportResult).toBe("fail");
		});
	});

	it("includes reviewed entries with their outcome", async () => {
		await withTempWorkspace(async (workspacePath) => {
			seedReport(workspacePath, baseReport);
			await recordValidationResult(
				workspacePath,
				"roadmap_auth01",
				baseReport.taskId,
				baseReport.result,
				baseReport.validatedAt,
			);
			await reviewValidation(workspacePath, "roadmap_auth01", baseReport.taskId, "accepted");

			const entries = await getLatestValidationsPerTask(workspacePath);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({
				taskId: baseReport.taskId,
				reviewed: true,
				reviewOutcome: "accepted",
			});
		});
	});
});
