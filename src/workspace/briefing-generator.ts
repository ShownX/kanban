import { type ChangelogEntry, readChangelogSince, readDecisions } from "./shared-memory";

/**
 * Startup briefing generator for multi-agent coordination.
 *
 * Reads shared-memory changelog and decisions, then produces a concise
 * markdown summary so an agent can quickly orient itself when starting
 * or resuming work.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerateBriefingOptions {
	workspacePath: string;
	agentId: string;
	ownedPaths: string[];
	lastCheckpoint?: string;
	/** Pre-loaded interfaces.md content (avoids a redundant read). */
	interfaces?: string;
}

export interface Briefing {
	markdown: string;
	relevantEntryCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approximate character budget (~500 tokens). */
const MAX_CHARS = 2000;

const MAX_CROSS_PROJECT = 5;
const MAX_DOMAIN_BEFORE_SUMMARY = 10;
const DOMAIN_SUMMARY_VISIBLE = 5;

const PENDING_PATTERN = /\b(pending|tbd|open question)\b/i;

const DEFAULT_LOOKBACK_DAYS = 7;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateBriefing(options: GenerateBriefingOptions): Promise<Briefing> {
	const { workspacePath, agentId, ownedPaths, lastCheckpoint } = options;

	const since = lastCheckpoint ?? daysAgo(DEFAULT_LOOKBACK_DAYS);
	const sinceLabel = lastCheckpoint ?? "7 days ago";

	const entries = await readChangelogSince(workspacePath, since);

	if (entries.length === 0) {
		const decisionsSection = await buildPendingDecisionsSection(workspacePath);
		if (decisionsSection.length === 0) {
			return {
				markdown: "No recent activity affecting your domain.",
				relevantEntryCount: 0,
			};
		}
		// Still show pending decisions even when the changelog is empty.
		const md = [`# Recent Activity Briefing`, `Since ${sinceLabel}:`, "", ...decisionsSection].join("\n");
		return { markdown: md, relevantEntryCount: 0 };
	}

	// Categorize
	const domainChanges: ChangelogEntry[] = [];
	const crossProject: ChangelogEntry[] = [];
	const unresolved: ChangelogEntry[] = [];

	for (const entry of entries) {
		if (isUnresolved(entry)) {
			unresolved.push(entry);
		}

		if (isDomainRelevant(entry, agentId, ownedPaths)) {
			domainChanges.push(entry);
		} else {
			crossProject.push(entry);
		}
	}

	const relevantEntryCount = domainChanges.length + unresolved.length;

	// Build sections
	const sections: string[] = [`# Recent Activity Briefing`, `Since ${sinceLabel}:`, ""];

	const domainSection = formatDomainChanges(domainChanges, agentId);
	const crossSection = formatCrossProjectChanges(crossProject);
	const unresolvedSection = formatUnresolved(unresolved);
	const pendingDecisions = await buildPendingDecisionsSection(workspacePath);

	// Always include unresolved and pending decisions in full.
	// Budget the remaining space for domain + cross-project.
	const fixedContent = [...unresolvedSection, ...pendingDecisions].join("\n");
	const remainingBudget = MAX_CHARS - fixedContent.length - 200; // 200 chars header overhead

	const domainLines = applyDomainBudget(domainSection, remainingBudget * 0.6);
	const crossLines = applyCrossBudget(crossSection, remainingBudget * 0.4);

	if (domainLines.length > 0) sections.push(...domainLines, "");
	if (crossLines.length > 0) sections.push(...crossLines, "");
	if (unresolvedSection.length > 0) sections.push(...unresolvedSection, "");
	if (pendingDecisions.length > 0) sections.push(...pendingDecisions, "");

	// If every section was empty (no domain, no cross, no unresolved, no decisions)
	if (
		domainLines.length === 0 &&
		crossLines.length === 0 &&
		unresolvedSection.length === 0 &&
		pendingDecisions.length === 0
	) {
		return {
			markdown: "No recent activity affecting your domain.",
			relevantEntryCount: 0,
		};
	}

	return { markdown: sections.join("\n").trimEnd(), relevantEntryCount };
}

// ---------------------------------------------------------------------------
// Categorization helpers
// ---------------------------------------------------------------------------

function isDomainRelevant(entry: ChangelogEntry, agentId: string, ownedPaths: string[]): boolean {
	// Files overlap with owned paths
	if (entry.files && entry.files.length > 0) {
		for (const file of entry.files) {
			for (const owned of ownedPaths) {
				if (file.startsWith(owned) || owned.startsWith(file)) {
					return true;
				}
			}
		}
	}

	// Interface field mentions the agent's project / id
	if (entry.interface && entry.interface.toLowerCase().includes(agentId.toLowerCase())) {
		return true;
	}

	return false;
}

function isUnresolved(entry: ChangelogEntry): boolean {
	return entry.needsPmReview === true || entry.event === "blocker_found";
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatEntryLine(entry: ChangelogEntry): string {
	const ts = entry.ts.slice(0, 16); // YYYY-MM-DDTHH:MM
	const description = entry.summary ?? entry.detail ?? entry.decision ?? entry.event;
	const filesSuffix = entry.files && entry.files.length > 0 ? ` — files: ${entry.files.join(", ")}` : "";
	return `- [${ts}] ${entry.agent}: ${description}${filesSuffix}`;
}

function formatDomainChanges(entries: ChangelogEntry[], agentId: string): string[] {
	if (entries.length === 0) return [];
	const lines: string[] = [`## Changes affecting your domain (${agentId})`];

	if (entries.length <= MAX_DOMAIN_BEFORE_SUMMARY) {
		for (const entry of entries) {
			lines.push(formatEntryLine(entry));
		}
	} else {
		for (const entry of entries.slice(0, DOMAIN_SUMMARY_VISIBLE)) {
			lines.push(formatEntryLine(entry));
		}
		lines.push(`- ... and ${entries.length - DOMAIN_SUMMARY_VISIBLE} more`);
	}
	return lines;
}

function formatCrossProjectChanges(entries: ChangelogEntry[]): string[] {
	if (entries.length === 0) return [];
	const lines: string[] = ["## Cross-project changes"];
	const shown = entries.slice(-MAX_CROSS_PROJECT); // most recent
	for (const entry of shown) {
		lines.push(formatEntryLine(entry));
	}
	if (entries.length > MAX_CROSS_PROJECT) {
		lines.push(`- ... and ${entries.length - MAX_CROSS_PROJECT} more`);
	}
	return lines;
}

function formatUnresolved(entries: ChangelogEntry[]): string[] {
	if (entries.length === 0) return [];
	const lines: string[] = ["## Unresolved items"];
	for (const entry of entries) {
		const ts = entry.ts.slice(0, 16);
		const description = entry.detail ?? entry.summary ?? entry.event;
		const suffix = entry.needsPmReview ? " (needs PM review)" : "";
		lines.push(`- [${ts}] ${entry.agent}: ${description}${suffix}`);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Pending decisions
// ---------------------------------------------------------------------------

async function buildPendingDecisionsSection(workspacePath: string): Promise<string[]> {
	const raw = await readDecisions(workspacePath);
	if (!raw) return [];

	const pendingLines: string[] = [];
	for (const line of raw.split("\n")) {
		if (PENDING_PATTERN.test(line)) {
			const trimmed = line.trim();
			if (trimmed) {
				// Normalize to a bullet if it isn't already one
				pendingLines.push(trimmed.startsWith("-") ? trimmed : `- ${trimmed}`);
			}
		}
	}
	if (pendingLines.length === 0) return [];
	return ["## Pending decisions", ...pendingLines];
}

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

function applyDomainBudget(lines: string[], charBudget: number): string[] {
	if (lines.length === 0) return [];
	const joined = lines.join("\n");
	if (joined.length <= charBudget) return lines;

	// Keep heading + first DOMAIN_SUMMARY_VISIBLE entries + ellipsis
	const heading = lines[0];
	const kept = lines.slice(1, DOMAIN_SUMMARY_VISIBLE + 1);
	const remaining = lines.length - 1 - DOMAIN_SUMMARY_VISIBLE;
	const result = [heading, ...kept];
	if (remaining > 0) {
		result.push(`- ... and ${remaining} more`);
	}
	return result;
}

function applyCrossBudget(lines: string[], charBudget: number): string[] {
	if (lines.length === 0) return [];
	const joined = lines.join("\n");
	if (joined.length <= charBudget) return lines;

	// Keep heading + last MAX_CROSS_PROJECT entries
	const heading = lines[0];
	const contentLines = lines.slice(1).filter((l) => !l.startsWith("- ..."));
	const kept = contentLines.slice(-MAX_CROSS_PROJECT);
	const trimmed = contentLines.length - MAX_CROSS_PROJECT;
	const result = [heading, ...kept];
	if (trimmed > 0) {
		result.push(`- ... and ${trimmed} more`);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}
