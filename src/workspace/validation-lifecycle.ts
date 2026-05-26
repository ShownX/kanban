import { readFile, writeFile } from "node:fs/promises";

import type { RuntimeBoardData, RuntimeRoadmapItemStatus } from "../core/api-contract.js";

import { loadProjectKpisForItem } from "./kpi-roadmap-loader.js";
import { buildKpiSnapshot } from "./kpi-snapshot.js";
import { readKpiStateFile } from "./kpi-state-file.js";
import { getRoadmapFilePath, parseRoadmapMarkdown, serializeRoadmap } from "./roadmap-file.js";
import type { ValidationReviewOutcome } from "./roadmap-state-file.js";
import {
	getOrCreateItemState,
	readRoadmapStateFile,
	setItemState,
	writeRoadmapStateFile,
} from "./roadmap-state-file.js";
import type { ValidationResult } from "./validator.js";

// ---------------------------------------------------------------------------
// Record a validation result into roadmap-state.json
// ---------------------------------------------------------------------------

/**
 * Append a new validation entry to a roadmap item's `pendingValidations`.
 * Called after `validateDeliverable()` writes the report file.
 */
export async function recordValidationResult(
	workspacePath: string,
	roadmapItemId: string,
	taskId: string,
	reportResult: ValidationResult,
	validatedAt: string,
): Promise<void> {
	const state = await readRoadmapStateFile(workspacePath);
	const itemState = getOrCreateItemState(state, roadmapItemId);

	// Avoid duplicates: if the same taskId already has an unreviewed entry, replace it
	const existing = itemState.pendingValidations.findIndex((v) => v.taskId === taskId && !v.reviewed);
	const entry = {
		taskId,
		reportResult,
		validatedAt,
		reviewed: false as const,
	};

	const updatedValidations = [...itemState.pendingValidations];
	if (existing >= 0) {
		updatedValidations[existing] = entry;
	} else {
		updatedValidations.push(entry);
	}

	const updatedItem = {
		...itemState,
		pendingValidations: updatedValidations,
		lastUpdatedAt: Date.now(),
	};

	const next = setItemState(state, roadmapItemId, updatedItem);
	await writeRoadmapStateFile(workspacePath, next);
}

// ---------------------------------------------------------------------------
// PM reviews a validation
// ---------------------------------------------------------------------------

/**
 * Mark a pending validation as reviewed with the given outcome.
 * Throws if the validation entry is not found.
 */
export async function reviewValidation(
	workspacePath: string,
	roadmapItemId: string,
	taskId: string,
	outcome: ValidationReviewOutcome,
	note?: string,
): Promise<void> {
	const state = await readRoadmapStateFile(workspacePath);
	const itemState = getOrCreateItemState(state, roadmapItemId);

	const idx = itemState.pendingValidations.findIndex((v) => v.taskId === taskId && !v.reviewed);
	if (idx < 0) {
		throw new Error(`No unreviewed validation found for taskId="${taskId}" on roadmap item "${roadmapItemId}"`);
	}

	const reviewedAt = new Date().toISOString();
	const updatedValidations = [...itemState.pendingValidations];
	const current = updatedValidations[idx];
	const trimmedNote = note?.trim();
	if (current) {
		updatedValidations[idx] = {
			...current,
			reviewed: true,
			reviewOutcome: outcome,
			reviewedAt,
			...(trimmedNote ? { reviewNote: trimmedNote } : {}),
		};
	}

	const updatedItem = {
		...itemState,
		pendingValidations: updatedValidations,
		lastUpdatedAt: Date.now(),
	};

	const next = setItemState(state, roadmapItemId, updatedItem);
	await writeRoadmapStateFile(workspacePath, next);

	// Persist the review into validation-report.md so the history travels with
	// git (roadmap-state.json is gitignored).
	const { appendReviewToReportFile } = await import("./validator.js");
	await appendReviewToReportFile(workspacePath, taskId, {
		outcome,
		reviewedAt,
		...(trimmedNote ? { note: trimmedNote } : {}),
	});

	// Drop a review-feedback file for the task agent to read on its next run.
	if (outcome !== "accepted") {
		const { writeReviewFeedback } = await import("./review-feedback-file.js");
		await writeReviewFeedback(workspacePath, taskId, {
			outcome,
			roadmapItemId,
			reviewedAt,
			...(trimmedNote ? { note: trimmedNote } : {}),
		});
	}
}

// ---------------------------------------------------------------------------
// Get all pending (unreviewed) validations across all roadmap items
// ---------------------------------------------------------------------------

export interface PendingValidationSummary {
	roadmapItemId: string;
	taskId: string;
	reportResult: ValidationResult;
	validatedAt: string;
}

export interface TaskValidationHistoryEntry {
	reportResult: ValidationResult;
	validatedAt: string;
	reviewed: boolean;
	reviewOutcome?: "accepted" | "rejected" | "escalated";
	reviewNote?: string;
	reviewedAt?: string;
}

/**
 * Return all validation entries (reviewed and pending) for a specific task.
 * Sorted newest-first by validatedAt. Used by the panel to show review
 * history beneath the latest report.
 *
 * Merges two sources:
 * 1. roadmap-state.json entries (gitignored, but live on the host)
 * 2. validation-report.md `## Reviews` entries (committed to git, so review
 *    history survives clones / state-file deletion)
 *
 * Reviews from the report file are matched by reviewedAt timestamp; only
 * unmatched entries are added so we don't double-count.
 */
export async function getTaskValidationHistory(
	workspacePath: string,
	taskId: string,
): Promise<TaskValidationHistoryEntry[]> {
	const state = await readRoadmapStateFile(workspacePath);
	const entries: TaskValidationHistoryEntry[] = [];
	const seenReviewedAt = new Set<string>();

	for (const itemState of Object.values(state.itemStates)) {
		for (const v of itemState.pendingValidations) {
			if (v.taskId !== taskId) continue;
			if (v.reviewedAt) seenReviewedAt.add(v.reviewedAt);
			entries.push({
				reportResult: v.reportResult,
				validatedAt: v.validatedAt,
				reviewed: v.reviewed,
				...(v.reviewOutcome ? { reviewOutcome: v.reviewOutcome } : {}),
				...(v.reviewNote ? { reviewNote: v.reviewNote } : {}),
				...(v.reviewedAt ? { reviewedAt: v.reviewedAt } : {}),
			});
		}
	}

	const { readValidationReportFile } = await import("./validator.js");
	const { report } = await readValidationReportFile(workspacePath, taskId);
	if (report?.reviews && report.reviews.length > 0) {
		for (const review of report.reviews) {
			if (seenReviewedAt.has(review.reviewedAt)) continue;
			entries.push({
				reportResult: report.result,
				validatedAt: report.validatedAt,
				reviewed: true,
				reviewOutcome: review.outcome,
				...(review.note ? { reviewNote: review.note } : {}),
				reviewedAt: review.reviewedAt,
			});
		}
	}

	entries.sort((a, b) => {
		const aTs = a.reviewedAt ? Date.parse(a.reviewedAt) : Date.parse(a.validatedAt);
		const bTs = b.reviewedAt ? Date.parse(b.reviewedAt) : Date.parse(b.validatedAt);
		return bTs - aTs;
	});
	return entries;
}

export interface LatestValidationPerTask {
	roadmapItemId: string;
	taskId: string;
	reportResult: ValidationResult;
	validatedAt: string;
	reviewed: boolean;
	reviewOutcome?: "accepted" | "rejected" | "escalated";
}

/**
 * Return the latest validation entry per task across all roadmap items
 * (reviewed or not). Used by board cards to show a status badge whether the
 * card is in review or done. The badge for done-column cards typically shows
 * the reviewer's outcome (accepted/rejected); for review-column cards it
 * shows the validator's reportResult.
 */
export async function getLatestValidationsPerTask(workspacePath: string): Promise<LatestValidationPerTask[]> {
	const state = await readRoadmapStateFile(workspacePath);
	const latestByTask = new Map<string, LatestValidationPerTask>();

	for (const [itemId, itemState] of Object.entries(state.itemStates)) {
		for (const v of itemState.pendingValidations) {
			const incoming: LatestValidationPerTask = {
				roadmapItemId: itemId,
				taskId: v.taskId,
				reportResult: v.reportResult,
				validatedAt: v.validatedAt,
				reviewed: v.reviewed,
				...(v.reviewOutcome ? { reviewOutcome: v.reviewOutcome } : {}),
			};
			const existing = latestByTask.get(v.taskId);
			if (!existing || Date.parse(incoming.validatedAt) >= Date.parse(existing.validatedAt)) {
				latestByTask.set(v.taskId, incoming);
			}
		}
	}

	return Array.from(latestByTask.values());
}

/**
 * Return all unreviewed validation entries across all roadmap items.
 * Used by the UI to show a notification badge.
 */
export async function getPendingValidations(workspacePath: string): Promise<PendingValidationSummary[]> {
	const state = await readRoadmapStateFile(workspacePath);
	const results: PendingValidationSummary[] = [];

	for (const [itemId, itemState] of Object.entries(state.itemStates)) {
		for (const v of itemState.pendingValidations) {
			if (!v.reviewed) {
				results.push({
					roadmapItemId: itemId,
					taskId: v.taskId,
					reportResult: v.reportResult,
					validatedAt: v.validatedAt,
				});
			}
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Auto-update ROADMAP.md status on full acceptance
// ---------------------------------------------------------------------------

/**
 * Check whether all tasks linked to a roadmap item have been validated and
 * accepted. If so, update the item's status in ROADMAP.md to "done" (green).
 *
 * @returns `true` if the roadmap file was updated, `false` otherwise.
 */
export async function maybeUpdateRoadmapStatus(
	workspacePath: string,
	roadmapItemId: string,
	board: RuntimeBoardData,
): Promise<boolean> {
	// Find the roadmap item
	const roadmapItem = board.roadmap.find((r) => r.id === roadmapItemId);
	if (!roadmapItem) return false;

	// Already done — nothing to update
	if (roadmapItem.status === "done") return false;

	// Gather all task IDs linked to this roadmap item
	const linkedTaskIds = new Set<string>();
	for (const ref of roadmapItem.tasks) {
		linkedTaskIds.add(ref.taskId);
	}
	for (const tid of roadmapItem.linkedTaskIds) {
		linkedTaskIds.add(tid);
	}

	// Must have at least one task to auto-promote
	if (linkedTaskIds.size === 0) return false;

	// Read the state to check validations
	const state = await readRoadmapStateFile(workspacePath);
	const itemState = state.itemStates[roadmapItemId];
	if (!itemState) return false;

	// Every linked task must have a reviewed + accepted validation
	for (const taskId of linkedTaskIds) {
		const accepted = itemState.pendingValidations.some(
			(v) => v.taskId === taskId && v.reviewed && v.reviewOutcome === "accepted",
		);
		if (!accepted) return false;
	}

	// All KPIs on the item (if any) must be met or waived. Items without
	// KPIs fall through to the legacy "all tasks accepted" rule unchanged
	// — see .plan/docs/kpi-tracking-design.md §"Sub-KPI -> KPI rollup".
	const { values: kpiDefinitions } = await loadProjectKpisForItem(workspacePath, roadmapItemId);
	if (kpiDefinitions.length > 0) {
		const kpiState = await readKpiStateFile(workspacePath);
		const snapshot = buildKpiSnapshot({
			itemId: roadmapItemId,
			definitions: kpiDefinitions,
			state: kpiState,
		});
		if (!snapshot.allMet) return false;
	}

	// All tasks accepted and (when present) all KPIs cleared — update ROADMAP.md
	const filePath = getRoadmapFilePath(workspacePath);
	let content: string;
	try {
		content = await readFile(filePath, "utf8");
	} catch {
		return false;
	}

	const items = parseRoadmapMarkdown(content);
	const target = items.find((item) => item.id === roadmapItemId);
	if (!target) return false;

	target.status = "done" satisfies RuntimeRoadmapItemStatus;
	target.updatedAt = Date.now();

	const updated = serializeRoadmap(items);
	await writeFile(filePath, updated, "utf8");

	return true;
}
