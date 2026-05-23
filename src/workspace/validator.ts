import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { parseDeliverableMd, readDeliverableMd } from "./deliverable-file.js";
import { readChangelog } from "./shared-memory.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const validationCheckNameSchema = z.enum([
	"requirements_coverage",
	"scope_compliance",
	"interface_compliance",
	"spec_staleness",
	"changelog_consistency",
]);
export type ValidationCheckName = z.infer<typeof validationCheckNameSchema>;

export const validationCheckStatusSchema = z.enum(["pass", "fail", "needs_review"]);
export type ValidationCheckStatus = z.infer<typeof validationCheckStatusSchema>;

export const validationCheckResultSchema = z.object({
	check: validationCheckNameSchema,
	status: validationCheckStatusSchema,
	details: z.string(),
});
export type ValidationCheckResult = z.infer<typeof validationCheckResultSchema>;

export const validationResultSchema = z.enum(["pass", "fail", "needs_review"]);
export type ValidationResult = z.infer<typeof validationResultSchema>;

/**
 * What the validator agent actually did. Captured separately from the per-check
 * results so reviewers can see the validator's work trail (steps performed,
 * supporting evidence) without re-reading the per-check details.
 */
export const validationWorkStepSchema = z.object({
	title: z.string(),
	status: z.enum(["done", "partial", "skipped"]).default("done"),
	detail: z.string().optional(),
});
export type ValidationWorkStep = z.infer<typeof validationWorkStepSchema>;

export const validationWorkSummarySchema = z.object({
	steps: z.array(validationWorkStepSchema).default([]),
	evidence: z.array(z.string()).default([]),
	durationMs: z.number().optional(),
	notes: z.string().optional(),
});
export type ValidationWorkSummary = z.infer<typeof validationWorkSummarySchema>;

export const validationReportSchema = z.object({
	taskId: z.string(),
	specSlug: z.string(),
	roadmapItemId: z.string(),
	result: validationResultSchema,
	validatedAt: z.string(),
	checks: z.array(validationCheckResultSchema),
	summary: z.string(),
	workSummary: validationWorkSummarySchema.optional(),
});
export type ValidationReport = z.infer<typeof validationReportSchema>;

// ---------------------------------------------------------------------------
// Requirement extraction
// ---------------------------------------------------------------------------

/**
 * Extract requirement IDs from a spec's requirements.md content.
 * Looks for patterns like **REQ-1:**, **US-1:**, **NFR-1:** and
 * EARS-style "WHEN ... THE SYSTEM SHALL" blocks.
 */
function extractRequirementIds(specContent: string): string[] {
	const ids: string[] = [];

	// Match **REQ-1:**, **US-1:**, **NFR-1:** etc.
	const boldIdPattern = /\*\*([A-Z]+-\d+):\s*[^*]+\*\*/g;
	for (let match = boldIdPattern.exec(specContent); match !== null; match = boldIdPattern.exec(specContent)) {
		if (match[1]) {
			ids.push(match[1]);
		}
	}

	// Match EARS patterns: lines containing "WHEN" followed by "THE SYSTEM SHALL"
	// These are unnumbered requirements — use line number as pseudo-ID.
	const lines = specContent.split("\n");
	let inEarsBlock = false;
	let earsStartLine = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trim() ?? "";
		if (/\bWHEN\b/i.test(line) && !inEarsBlock) {
			inEarsBlock = true;
			earsStartLine = i + 1;
		}
		if (inEarsBlock && /\bTHE SYSTEM SHALL\b/i.test(line)) {
			// Only add if this wasn't already captured as a named requirement
			const alreadyCaptured = ids.some((id) => {
				const idLinePattern = new RegExp(`\\*\\*${id}:`);
				// Check if the EARS block is within a named requirement block
				for (let j = Math.max(0, earsStartLine - 3); j <= earsStartLine; j++) {
					if (idLinePattern.test(lines[j] ?? "")) return true;
				}
				return false;
			});
			if (!alreadyCaptured) {
				ids.push(`EARS-L${earsStartLine}`);
			}
			inEarsBlock = false;
		}
		// Reset if we hit a blank line or heading while looking for SHALL
		if (inEarsBlock && (line === "" || line.startsWith("#"))) {
			inEarsBlock = false;
		}
	}

	return ids;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

interface RequirementsCoverageInput {
	workspacePath: string;
	specSlug: string;
	taskId: string;
}

async function checkRequirementsCoverage(input: RequirementsCoverageInput): Promise<ValidationCheckResult> {
	const { workspacePath, specSlug, taskId } = input;

	// Read the spec's requirements.md
	const reqPath = join(workspacePath, ".kanban", "specs", specSlug, "requirements.md");
	let specContent: string;
	try {
		specContent = await readFile(reqPath, "utf8");
	} catch {
		return {
			check: "requirements_coverage",
			status: "needs_review",
			details: `Spec requirements file not found at ${reqPath}. Cannot verify requirements coverage.`,
		};
	}

	// Read and parse the deliverable
	const md = await readDeliverableMd(workspacePath, taskId);
	if (!md) {
		return {
			check: "requirements_coverage",
			status: "fail",
			details: "No deliverable.md found. Cannot verify requirements coverage.",
		};
	}
	const deliverable = parseDeliverableMd(md, taskId);

	// Extract requirement IDs from spec
	const specReqIds = extractRequirementIds(specContent);
	if (specReqIds.length === 0) {
		return {
			check: "requirements_coverage",
			status: "needs_review",
			details: "No identifiable requirements found in spec. Cannot verify coverage.",
		};
	}

	// Build a set of requirement strings mentioned in the deliverable
	const deliverableReqStrings = deliverable.requirementsCheck.map((r) => r.requirement.toLowerCase());

	// Check each spec requirement against deliverable entries
	const missing: string[] = [];
	const partial: string[] = [];
	for (const reqId of specReqIds) {
		const lowerReqId = reqId.toLowerCase();
		const matched = deliverable.requirementsCheck.find((r) => r.requirement.toLowerCase().includes(lowerReqId));
		if (!matched) {
			// Fallback: check if the deliverable mentions this requirement ID anywhere
			const mentionedAnywhere = deliverableReqStrings.some((s) => s.includes(lowerReqId));
			if (!mentionedAnywhere) {
				missing.push(reqId);
			}
		} else if (matched.status === "partial") {
			partial.push(reqId);
		}
	}

	if (missing.length > 0) {
		return {
			check: "requirements_coverage",
			status: "fail",
			details: `Missing requirements: ${missing.join(", ")}. These spec requirements are not addressed in the deliverable.`,
		};
	}
	if (partial.length > 0) {
		return {
			check: "requirements_coverage",
			status: "needs_review",
			details: `Partial requirements: ${partial.join(", ")}. These requirements are only partially met.`,
		};
	}

	return {
		check: "requirements_coverage",
		status: "pass",
		details: `All ${specReqIds.length} spec requirement(s) are addressed in the deliverable.`,
	};
}

interface ScopeComplianceInput {
	workspacePath: string;
	taskId: string;
	ownedPaths: string[];
}

async function checkScopeCompliance(input: ScopeComplianceInput): Promise<ValidationCheckResult> {
	const { workspacePath, taskId, ownedPaths } = input;

	const md = await readDeliverableMd(workspacePath, taskId);
	if (!md) {
		return {
			check: "scope_compliance",
			status: "fail",
			details: "No deliverable.md found. Cannot verify scope compliance.",
		};
	}
	const deliverable = parseDeliverableMd(md, taskId);

	if (deliverable.changedFiles.length === 0) {
		return {
			check: "scope_compliance",
			status: "pass",
			details: "No changed files listed in deliverable.",
		};
	}

	// Check each changed file against owned paths (prefix matching)
	const outOfScope: string[] = [];
	for (const file of deliverable.changedFiles) {
		const normalizedFile = file.replace(/^\//, ""); // strip leading slash
		const inScope = ownedPaths.some((owned) => {
			const normalizedOwned = owned.replace(/^\//, "");
			return normalizedFile.startsWith(normalizedOwned);
		});
		if (!inScope) {
			outOfScope.push(file);
		}
	}

	if (outOfScope.length > 0) {
		return {
			check: "scope_compliance",
			status: "fail",
			details: `Files outside owned scope: ${outOfScope.join(", ")}`,
		};
	}

	return {
		check: "scope_compliance",
		status: "pass",
		details: `All ${deliverable.changedFiles.length} changed file(s) are within owned paths.`,
	};
}

interface InterfaceComplianceInput {
	workspacePath: string;
	specSlug: string;
}

async function checkInterfaceCompliance(input: InterfaceComplianceInput): Promise<ValidationCheckResult> {
	const { workspacePath, specSlug } = input;

	// Read changelog and look for interface_concern entries from this agent
	const changelog = await readChangelog(workspacePath);
	const interfaceConcerns = changelog.filter(
		(entry) => entry.event === "interface_concern" && entry.agent === specSlug && entry.needsPmReview === true,
	);

	if (interfaceConcerns.length > 0) {
		const details = interfaceConcerns
			.map((c) => `- ${c.interface ?? "unknown interface"}: ${c.detail ?? "no details"}`)
			.join("\n");
		return {
			check: "interface_compliance",
			status: "needs_review",
			details: `Found ${interfaceConcerns.length} unresolved interface concern(s) from agent "${specSlug}":\n${details}`,
		};
	}

	return {
		check: "interface_compliance",
		status: "pass",
		details: "No unresolved interface concerns from this agent.",
	};
}

interface SpecStalenessInput {
	workspacePath: string;
	taskId: string;
	specVersion?: number;
}

async function checkSpecStaleness(input: SpecStalenessInput): Promise<ValidationCheckResult> {
	const { workspacePath, taskId, specVersion } = input;

	if (specVersion == null) {
		return {
			check: "spec_staleness",
			status: "pass",
			details: "No spec version provided. Staleness check skipped.",
		};
	}

	const md = await readDeliverableMd(workspacePath, taskId);
	if (!md) {
		return {
			check: "spec_staleness",
			status: "fail",
			details: "No deliverable.md found. Cannot verify spec staleness.",
		};
	}
	const deliverable = parseDeliverableMd(md, taskId);

	if (deliverable.roadmapVersion == null) {
		return {
			check: "spec_staleness",
			status: "pass",
			details: "Deliverable does not include a roadmap version. Staleness check skipped.",
		};
	}

	if (deliverable.roadmapVersion !== specVersion) {
		return {
			check: "spec_staleness",
			status: "needs_review",
			details: `Spec version mismatch: deliverable v${deliverable.roadmapVersion}, current v${specVersion}. The spec may have been updated since the deliverable was written.`,
		};
	}

	return {
		check: "spec_staleness",
		status: "pass",
		details: `Deliverable version (v${deliverable.roadmapVersion}) matches current spec version (v${specVersion}).`,
	};
}

interface ChangelogConsistencyInput {
	workspacePath: string;
	taskId: string;
	specSlug: string;
}

async function checkChangelogConsistency(input: ChangelogConsistencyInput): Promise<ValidationCheckResult> {
	const { workspacePath, taskId, specSlug } = input;

	const md = await readDeliverableMd(workspacePath, taskId);
	if (!md) {
		return {
			check: "changelog_consistency",
			status: "fail",
			details: "No deliverable.md found. Cannot verify changelog consistency.",
		};
	}
	const deliverable = parseDeliverableMd(md, taskId);

	const changelog = await readChangelog(workspacePath);
	const agentEntries = changelog.filter(
		(entry) => entry.agent === specSlug && (entry.event === "file_modified" || entry.event === "file_created"),
	);

	// If no changelog entries and no changed files, that's fine
	if (agentEntries.length === 0 && deliverable.changedFiles.length === 0) {
		return {
			check: "changelog_consistency",
			status: "pass",
			details: "No changelog entries and no changed files in deliverable. Consistent.",
		};
	}

	// Collect all files mentioned in changelog entries from this agent
	const changelogFiles = new Set<string>();
	for (const entry of agentEntries) {
		if (entry.files) {
			for (const file of entry.files) {
				changelogFiles.add(file);
			}
		}
	}

	const deliverableFiles = new Set(deliverable.changedFiles.map((f) => f.replace(/^\//, "")));

	// Files in deliverable but not in changelog
	const onlyInDeliverable: string[] = [];
	for (const file of deliverableFiles) {
		if (!changelogFiles.has(file)) {
			onlyInDeliverable.push(file);
		}
	}

	// Files in changelog but not in deliverable
	const onlyInChangelog: string[] = [];
	for (const file of changelogFiles) {
		if (!deliverableFiles.has(file)) {
			onlyInChangelog.push(file);
		}
	}

	const totalFiles = new Set([...changelogFiles, ...deliverableFiles]).size;
	const divergentFiles = onlyInDeliverable.length + onlyInChangelog.length;

	// "Significant divergence" = more than half the files diverge
	if (totalFiles > 0 && divergentFiles > totalFiles / 2) {
		const parts: string[] = [];
		if (onlyInDeliverable.length > 0) {
			parts.push(`In deliverable only: ${onlyInDeliverable.join(", ")}`);
		}
		if (onlyInChangelog.length > 0) {
			parts.push(`In changelog only: ${onlyInChangelog.join(", ")}`);
		}
		return {
			check: "changelog_consistency",
			status: "needs_review",
			details: `Significant divergence between changelog and deliverable file lists. ${parts.join(". ")}`,
		};
	}

	return {
		check: "changelog_consistency",
		status: "pass",
		details:
			divergentFiles === 0
				? "Changed files in deliverable align with changelog entries."
				: `Minor divergence (${divergentFiles}/${totalFiles} files differ). Acceptable overlap.`,
	};
}

// ---------------------------------------------------------------------------
// Overall result computation
// ---------------------------------------------------------------------------

function computeOverallResult(checks: ValidationCheckResult[]): ValidationResult {
	if (checks.some((c) => c.status === "fail")) {
		return "fail";
	}
	if (checks.some((c) => c.status === "needs_review")) {
		return "needs_review";
	}
	return "pass";
}

function computeSummary(checks: ValidationCheckResult[], overallResult: ValidationResult): string {
	const failedChecks = checks.filter((c) => c.status === "fail");
	const reviewChecks = checks.filter((c) => c.status === "needs_review");
	const passedChecks = checks.filter((c) => c.status === "pass");

	if (overallResult === "pass") {
		return `All ${checks.length} checks passed. Deliverable meets spec requirements and scope constraints.`;
	}
	if (overallResult === "fail") {
		const failNames = failedChecks.map((c) => c.check).join(", ");
		return `Validation failed on: ${failNames}. ${passedChecks.length}/${checks.length} checks passed.`;
	}
	// needs_review
	const reviewNames = reviewChecks.map((c) => c.check).join(", ");
	return `PM review needed for: ${reviewNames}. ${passedChecks.length}/${checks.length} checks passed outright.`;
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

export interface ValidateDeliverableOptions {
	workspacePath: string;
	taskId: string;
	specSlug: string;
	roadmapItemId: string;
	ownedPaths: string[];
	specVersion?: number;
}

export async function validateDeliverable(options: ValidateDeliverableOptions): Promise<ValidationReport> {
	const { workspacePath, taskId, specSlug, roadmapItemId, ownedPaths, specVersion } = options;

	// Run all five checks in parallel
	const [requirementsCoverage, scopeCompliance, interfaceCompliance, specStaleness, changelogConsistency] =
		await Promise.all([
			checkRequirementsCoverage({ workspacePath, specSlug, taskId }),
			checkScopeCompliance({ workspacePath, taskId, ownedPaths }),
			checkInterfaceCompliance({ workspacePath, specSlug }),
			checkSpecStaleness({ workspacePath, taskId, specVersion }),
			checkChangelogConsistency({ workspacePath, taskId, specSlug }),
		]);

	const checks: ValidationCheckResult[] = [
		requirementsCoverage,
		scopeCompliance,
		interfaceCompliance,
		specStaleness,
		changelogConsistency,
	];

	const result = computeOverallResult(checks);
	const summary = computeSummary(checks, result);

	return {
		taskId,
		specSlug,
		roadmapItemId,
		result,
		validatedAt: new Date().toISOString(),
		checks,
		summary,
	};
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<ValidationCheckStatus, string> = {
	pass: "✓",
	fail: "✗",
	needs_review: "⚠",
};

const RESULT_LABEL: Record<ValidationResult, string> = {
	pass: "Pass",
	fail: "Fail",
	needs_review: "Needs Review",
};

export function serializeValidationReport(report: ValidationReport): string {
	const lines: string[] = [];

	lines.push(`# Validation Report: ${report.taskId}`);
	lines.push("");
	lines.push(`**Spec:** ${report.specSlug}`);
	lines.push(`**Roadmap item:** ${report.roadmapItemId}`);
	lines.push(`**Result:** ${RESULT_LABEL[report.result]}`);
	lines.push(`**Validated at:** ${report.validatedAt}`);
	lines.push("");

	if (report.workSummary) {
		const work = report.workSummary;
		lines.push("## Validator Work");
		for (const step of work.steps) {
			const flag = step.status === "done" ? "x" : step.status === "partial" ? "~" : " ";
			const detail = step.detail ? ` — ${step.detail}` : "";
			lines.push(`- [${flag}] ${step.title}${detail}`);
		}
		if (work.evidence.length > 0) {
			lines.push("");
			lines.push("**Evidence:**");
			for (const item of work.evidence) {
				lines.push(`- ${item}`);
			}
		}
		if (work.durationMs != null) {
			lines.push("");
			lines.push(`**Duration:** ${work.durationMs}ms`);
		}
		if (work.notes) {
			lines.push("");
			lines.push(work.notes);
		}
		lines.push("");
	}

	for (const check of report.checks) {
		const heading = formatCheckHeading(check.check);
		const icon = STATUS_ICON[check.status];
		lines.push(`## ${heading}`);
		lines.push(`${icon} ${check.details}`);
		lines.push("");
	}

	lines.push("## Summary");
	lines.push(report.summary);
	lines.push("");

	return lines.join("\n");
}

function formatCheckHeading(checkName: ValidationCheckName): string {
	switch (checkName) {
		case "requirements_coverage":
			return "Requirements Coverage";
		case "scope_compliance":
			return "Scope Compliance";
		case "interface_compliance":
			return "Interface Compliance";
		case "spec_staleness":
			return "Spec Staleness";
		case "changelog_consistency":
			return "Changelog Consistency";
	}
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function getValidationReportPath(workspacePath: string, taskId: string): string {
	return join(workspacePath, ".kanban", "tasks", taskId, "validation-report.md");
}

export async function writeValidationReport(
	workspacePath: string,
	taskId: string,
	report: ValidationReport,
): Promise<void> {
	const filePath = getValidationReportPath(workspacePath, taskId);
	await mkdir(dirname(filePath), { recursive: true });
	const content = serializeValidationReport(report);
	await writeFile(filePath, content, "utf8");
}

/**
 * Append a "Reviews" entry to the validation-report.md so the reviewer's
 * outcome and note travel with the report file (which can be committed),
 * not just roadmap-state.json (which is gitignored).
 *
 * Multiple reviews append below the previous ones, newest at the bottom,
 * under a single "## Reviews" section.
 */
export async function appendReviewToReportFile(
	workspacePath: string,
	taskId: string,
	review: { outcome: "accepted" | "rejected" | "escalated"; reviewedAt: string; note?: string },
): Promise<void> {
	const filePath = getValidationReportPath(workspacePath, taskId);
	let existing: string;
	try {
		existing = await readFile(filePath, "utf8");
	} catch {
		// No report on disk; nothing to append to.
		return;
	}

	const reviewsHeading = "## Reviews";
	const block = serializeReviewBlock(review);

	let next: string;
	if (existing.includes(reviewsHeading)) {
		// Append within the existing Reviews section, after its last entry.
		next = existing.replace(/\s*$/, ""); // trim trailing whitespace
		next = `${next}\n\n${block}\n`;
	} else {
		// Add a new Reviews section at the end.
		next = existing.replace(/\s*$/, "");
		next = `${next}\n\n${reviewsHeading}\n\n${block}\n`;
	}
	await writeFile(filePath, next, "utf8");
}

function serializeReviewBlock(review: {
	outcome: "accepted" | "rejected" | "escalated";
	reviewedAt: string;
	note?: string;
}): string {
	const label = review.outcome === "accepted" ? "Accepted" : review.outcome === "rejected" ? "Rejected" : "Escalated";
	const lines: string[] = [];
	lines.push(`### ${label} — ${review.reviewedAt}`);
	if (review.note) {
		lines.push("");
		lines.push(review.note);
	}
	return lines.join("\n");
}

export async function readValidationReportFile(
	workspacePath: string,
	taskId: string,
): Promise<{ content: string | null; report: ValidationReport | null }> {
	const filePath = getValidationReportPath(workspacePath, taskId);
	let content: string;
	try {
		content = await readFile(filePath, "utf8");
	} catch {
		return { content: null, report: null };
	}

	// Try to parse the report back from the markdown.
	// Since the markdown is our serialization format, we parse what we can.
	const report = parseValidationReportMd(content);
	return { content, report };
}

// ---------------------------------------------------------------------------
// Report markdown parser (best-effort, mirrors serializeValidationReport)
// ---------------------------------------------------------------------------

function parseValidationReportMd(content: string): ValidationReport | null {
	const lines = content.split("\n");

	// Extract metadata
	let taskId = "";
	let specSlug = "";
	let roadmapItemId = "";
	let result: ValidationResult = "needs_review";
	let validatedAt = "";
	let summary = "";
	const checks: ValidationCheckResult[] = [];
	const workSteps: ValidationWorkStep[] = [];
	const workEvidence: string[] = [];
	let workNotes = "";
	let workDurationMs: number | undefined;
	let sawWorkSection = false;

	let currentSection = "none";
	let currentCheckName: ValidationCheckName | null = null;
	let workSubSection: "steps" | "evidence" | "notes" = "steps";

	for (const line of lines) {
		const trimmed = line.trim();

		// Title line
		const titleMatch = trimmed.match(/^# Validation Report:\s*(.+)$/);
		if (titleMatch?.[1]) {
			taskId = titleMatch[1].trim();
			continue;
		}

		// Metadata lines
		if (trimmed.startsWith("**Spec:**")) {
			specSlug = trimmed.replace(/^\*\*Spec:\*\*\s*/, "").trim();
			continue;
		}
		if (trimmed.startsWith("**Roadmap item:**")) {
			roadmapItemId = trimmed.replace(/^\*\*Roadmap item:\*\*\s*/, "").trim();
			continue;
		}
		if (trimmed.startsWith("**Result:**")) {
			const raw = trimmed
				.replace(/^\*\*Result:\*\*\s*/, "")
				.trim()
				.toLowerCase();
			if (raw === "pass") result = "pass";
			else if (raw === "fail") result = "fail";
			else result = "needs_review";
			continue;
		}
		if (trimmed.startsWith("**Validated at:**")) {
			validatedAt = trimmed.replace(/^\*\*Validated at:\*\*\s*/, "").trim();
			continue;
		}
		if (trimmed.startsWith("**Evidence:**")) {
			if (currentSection === "work") workSubSection = "evidence";
			continue;
		}
		if (trimmed.startsWith("**Duration:**")) {
			if (currentSection === "work") {
				const raw = trimmed.replace(/^\*\*Duration:\*\*\s*/, "").trim();
				const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i);
				if (match) {
					const n = Number.parseFloat(match[1] ?? "");
					const unit = (match[2] ?? "ms").toLowerCase();
					workDurationMs =
						unit === "s" ? Math.round(n * 1000) : unit === "m" ? Math.round(n * 60_000) : Math.round(n);
				}
			}
			continue;
		}

		// Section headings
		if (trimmed.startsWith("## ")) {
			const heading = trimmed.slice(3).trim();
			if (heading === "Summary") {
				currentSection = "summary";
				currentCheckName = null;
				continue;
			}
			if (heading === "Validator Work" || heading === "Validator Work Summary") {
				currentSection = "work";
				currentCheckName = null;
				sawWorkSection = true;
				workSubSection = "steps";
				continue;
			}
			const checkName = parseCheckHeading(heading);
			if (checkName) {
				currentSection = "check";
				currentCheckName = checkName;
				continue;
			}
			currentSection = "other";
			currentCheckName = null;
			continue;
		}

		// Content routing
		if (currentSection === "summary" && trimmed) {
			summary += (summary ? " " : "") + trimmed;
		} else if (currentSection === "work") {
			if (workSubSection === "steps") {
				const stepMatch = trimmed.match(/^-\s*\[([ x~])\]\s*(.+)$/);
				if (stepMatch?.[2]) {
					const flag = stepMatch[1];
					const status: ValidationWorkStep["status"] =
						flag === "x" ? "done" : flag === "~" ? "partial" : "skipped";
					const parts = stepMatch[2].split("—").map((s) => s.trim());
					workSteps.push({
						title: parts[0] ?? stepMatch[2],
						status,
						...(parts[1] ? { detail: parts[1] } : {}),
					});
				} else if (trimmed.startsWith("- ")) {
					workSteps.push({ title: trimmed.slice(2), status: "done" });
				} else if (trimmed) {
					workNotes += (workNotes ? " " : "") + trimmed;
				}
			} else if (workSubSection === "evidence") {
				if (trimmed.startsWith("- ")) workEvidence.push(trimmed.slice(2));
			}
		} else if (currentSection === "check" && currentCheckName && trimmed) {
			// The line after the heading contains the status icon and details
			let status: ValidationCheckStatus = "needs_review";
			let details = trimmed;
			if (trimmed.startsWith("✓ ")) {
				status = "pass";
				details = trimmed.slice(2);
			} else if (trimmed.startsWith("✗ ")) {
				status = "fail";
				details = trimmed.slice(2);
			} else if (trimmed.startsWith("⚠ ")) {
				status = "needs_review";
				details = trimmed.slice(2);
			}

			// Only capture the first content line as the check result
			const existingCheck = checks.find((c) => c.check === currentCheckName);
			if (!existingCheck) {
				checks.push({ check: currentCheckName, status, details });
			} else {
				// Append additional lines to details
				existingCheck.details += `\n${trimmed}`;
			}
		}
	}

	if (!taskId) return null;

	const workSummary: ValidationWorkSummary | undefined = sawWorkSection
		? {
				steps: workSteps,
				evidence: workEvidence,
				...(workDurationMs != null ? { durationMs: workDurationMs } : {}),
				...(workNotes ? { notes: workNotes } : {}),
			}
		: undefined;

	return {
		taskId,
		specSlug,
		roadmapItemId,
		result,
		validatedAt,
		checks,
		summary,
		...(workSummary ? { workSummary } : {}),
	};
}

function parseCheckHeading(heading: string): ValidationCheckName | null {
	switch (heading) {
		case "Requirements Coverage":
			return "requirements_coverage";
		case "Scope Compliance":
			return "scope_compliance";
		case "Interface Compliance":
			return "interface_compliance";
		case "Spec Staleness":
			return "spec_staleness";
		case "Changelog Consistency":
			return "changelog_consistency";
		default:
			return null;
	}
}
