// Internal parser is not exported; round-trip through the file path is heavy.
// Instead, exercise serializeValidationReport, then parse via readValidationReportFile
// after writing to a temp dir.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	readValidationReportFile as _readValidationReportFile,
	serializeValidationReport,
	type ValidationReport,
} from "../../src/workspace/validator";

function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "kanban-validator-test-"));
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
	checks: [
		{ check: "requirements_coverage", status: "pass", details: "All 3 requirements covered." },
		{ check: "scope_compliance", status: "needs_review", details: "Found foo.ts outside owned paths." },
		{ check: "interface_compliance", status: "pass", details: "No concerns." },
		{ check: "spec_staleness", status: "pass", details: "Versions match." },
		{ check: "changelog_consistency", status: "pass", details: "Aligned." },
	],
	summary: "PM review needed for: scope_compliance.",
};

describe("validator serialize/parse round-trip", () => {
	it("preserves checks and metadata", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const taskDir = join(workspacePath, ".kanban", "tasks", baseReport.taskId);
			mkdirSync(taskDir, { recursive: true });
			const md = serializeValidationReport(baseReport);
			writeFileSync(join(taskDir, "validation-report.md"), md, "utf8");

			const { report } = await _readValidationReportFile(workspacePath, baseReport.taskId);
			expect(report).not.toBeNull();
			if (!report) return;
			expect(report.taskId).toBe("t_login01");
			expect(report.specSlug).toBe("user-auth");
			expect(report.result).toBe("needs_review");
			expect(report.validatedAt).toBe("2026-05-22T12:00:00.000Z");
			expect(report.checks).toHaveLength(5);
			expect(report.checks[1]).toMatchObject({
				check: "scope_compliance",
				status: "needs_review",
			});
			expect(report.summary).toContain("scope_compliance");
		});
	});

	it("preserves a workSummary section", async () => {
		await withTempWorkspace(async (workspacePath) => {
			const reportWithWork: ValidationReport = {
				...baseReport,
				workSummary: {
					steps: [
						{ title: "Read spec requirements", status: "done" },
						{ title: "Inspect changelog", status: "partial", detail: "skipped diff context" },
					],
					evidence: [".kanban/specs/user-auth/requirements.md", ".kanban/tasks/t_login01/deliverable.md"],
					durationMs: 4500,
				},
			};
			const taskDir = join(workspacePath, ".kanban", "tasks", baseReport.taskId);
			mkdirSync(taskDir, { recursive: true });
			const md = serializeValidationReport(reportWithWork);
			writeFileSync(join(taskDir, "validation-report.md"), md, "utf8");

			const { report } = await _readValidationReportFile(workspacePath, baseReport.taskId);
			expect(report?.workSummary).toBeDefined();
			expect(report?.workSummary?.steps).toHaveLength(2);
			expect(report?.workSummary?.steps[1]).toMatchObject({
				status: "partial",
				detail: "skipped diff context",
			});
			expect(report?.workSummary?.evidence).toEqual([
				".kanban/specs/user-auth/requirements.md",
				".kanban/tasks/t_login01/deliverable.md",
			]);
			expect(report?.workSummary?.durationMs).toBe(4500);
		});
	});
});
