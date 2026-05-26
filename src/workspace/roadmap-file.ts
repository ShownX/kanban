import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RuntimeRoadmapItem, RuntimeRoadmapItemStatus } from "../core/api-contract";

const ROADMAP_PATH = join(".kanban", "ROADMAP.md");

export function getRoadmapFilePath(workspacePath: string): string {
	return join(workspacePath, ROADMAP_PATH);
}

export async function readRoadmapFile(workspacePath: string): Promise<{ exists: boolean; content: string }> {
	const filePath = getRoadmapFilePath(workspacePath);
	try {
		const content = await readFile(filePath, "utf8");
		return { exists: true, content };
	} catch {
		return { exists: false, content: "" };
	}
}

export async function writeRoadmapFromItems(workspacePath: string, items: RuntimeRoadmapItem[]): Promise<void> {
	const filePath = getRoadmapFilePath(workspacePath);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, serializeRoadmap(items), "utf8");
}

// ---------------------------------------------------------------------------
// V2 table-format serializer (default)
// ---------------------------------------------------------------------------

/**
 * Serialize roadmap items into the V2 table-based ROADMAP.md format.
 *
 * Layout:
 *   # Project Roadmap
 *   ## Introduction
 *   <intro paragraph>
 *   ## Items
 *   | ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |
 *   ...rows...
 *   ## Comments
 *   > [timestamp] text
 */
export function serializeRoadmapTable(items: RuntimeRoadmapItem[], intro?: string): string {
	const lines: string[] = ["# Project Roadmap\n"];

	// Introduction section
	lines.push("## Introduction\n");
	lines.push(intro ? `${intro}\n` : "Project roadmap.\n");

	// Items table
	lines.push("## Items\n");
	lines.push("| ID | POC | Title | Description | Goal (Exit Criteria) | Spec | Status | Launch Date |");
	lines.push("|----|-----|-------|-------------|---------------------|------|--------|-------------|");

	for (const item of items) {
		const id = escapeTableCell(item.id);
		const poc = escapeTableCell(item.poc ?? item.owner ?? "");
		const title = escapeTableCell(item.title);
		const description = escapeTableCell(item.description);
		const goal = escapeTableCell(item.goal ?? "");
		const spec = item.specSlug ? `[spec](specs/${item.specSlug}/)` : "";
		const status = formatStatus(item.status);
		const launchDate = item.endDate && isValidIsoDate(item.endDate) ? item.endDate : "";

		lines.push(`| ${id} | ${poc} | ${title} | ${description} | ${goal} | ${spec} | ${status} | ${launchDate} |`);
	}

	lines.push("");

	// Aggregate all comments across items
	const allComments: Array<{ text: string; createdAt: number }> = [];
	for (const item of items) {
		for (const c of item.comments) {
			allComments.push(c);
		}
	}
	if (allComments.length > 0) {
		// Sort comments chronologically
		allComments.sort((a, b) => a.createdAt - b.createdAt);
		lines.push("## Comments\n");
		for (const c of allComments) {
			const date = new Date(c.createdAt).toISOString();
			lines.push(`> [${date}] ${c.text}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/** Default serializer — uses the V2 table format. */
export function serializeRoadmap(items: RuntimeRoadmapItem[], intro?: string): string {
	return serializeRoadmapTable(items, intro);
}

/**
 * Escape a value for inclusion inside a markdown table cell.
 * Pipes and newlines would break the table layout.
 */
function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ---------------------------------------------------------------------------
// V1 per-item serializer (kept for back-compat / .v1.bak files)
// ---------------------------------------------------------------------------

export function serializeRoadmapV1(items: RuntimeRoadmapItem[]): string {
	if (items.length === 0) {
		return "# Roadmap\n\nNo items yet.\n";
	}
	const lines: string[] = ["# Roadmap\n"];
	for (const item of items) {
		lines.push(`## ${item.title}`);
		lines.push(`**ID:** \`${item.id}\``);
		lines.push(`**Status:** ${formatStatus(item.status)}`);
		if (item.version != null) lines.push(`**Version:** ${item.version}`);
		if (item.owner) lines.push(`**Owner:** ${item.owner}`);
		if (item.startDate && isValidIsoDate(item.startDate)) lines.push(`**Start:** ${item.startDate}`);
		if (item.endDate && isValidIsoDate(item.endDate)) lines.push(`**End:** ${item.endDate}`);
		if (item.milestone === true) lines.push(`**Milestone:** true`);
		lines.push("");
		if (item.description) {
			lines.push(`${item.description}\n`);
		}
		if (item.goal) {
			lines.push(`**Goal:** ${item.goal}\n`);
		}
		if (item.specSlug) {
			lines.push(`**Spec:** [specs/${item.specSlug}/](specs/${item.specSlug}/)\n`);
		}
		const taskRefs =
			item.tasks.length > 0
				? item.tasks
				: item.linkedTaskIds.map((taskId) => ({ taskId, title: "", agentCreated: false }));
		if (taskRefs.length > 0) {
			lines.push("### Tasks\n");
			for (const ref of taskRefs) {
				const titleSuffix = ref.title ? ` ${ref.title}` : "";
				const agentSuffix = ref.agentCreated ? " _(agent-created)_" : "";
				lines.push(`- [ ] \`${ref.taskId}\`${titleSuffix}${agentSuffix}`);
			}
			lines.push("");
		}
		if (item.openQuestions.length > 0) {
			lines.push("### Open questions\n");
			for (const q of item.openQuestions) {
				const check = q.resolved ? "x" : " ";
				lines.push(`- [${check}] ${q.text}`);
			}
			lines.push("");
		}
		if (item.comments.length > 0) {
			lines.push("### Comments\n");
			for (const c of item.comments) {
				const date = new Date(c.createdAt).toISOString();
				lines.push(`> [${date}] ${c.text}`);
			}
			lines.push("");
		}
		lines.push("---\n");
	}
	return lines.join("\n");
}

function formatStatus(status: RuntimeRoadmapItemStatus): string {
	switch (status) {
		case "planned":
			return "🔵 Planned";
		case "in_progress":
			return "🟠 In Progress";
		case "done":
			return "🟢 Done";
		default:
			return "🔵 Planned";
	}
}

function parseStatus(text: string): RuntimeRoadmapItemStatus {
	const lower = text.toLowerCase();
	if (lower.includes("in progress") || lower.includes("in_progress") || lower.includes("🟠")) return "in_progress";
	if (lower.includes("done") || lower.includes("complete") || lower.includes("🟢")) return "done";
	return "planned";
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate an ISO 8601 calendar date in `YYYY-MM-DD` form.
 * Rejects malformed strings, out-of-range months/days, and non-existent
 * calendar dates (e.g. Feb 30, Apr 31).
 */
export function isValidIsoDate(value: string): boolean {
	if (!ISO_DATE_PATTERN.test(value)) return false;
	const [yearStr, monthStr, dayStr] = value.split("-");
	const year = Number.parseInt(yearStr ?? "", 10);
	const month = Number.parseInt(monthStr ?? "", 10);
	const day = Number.parseInt(dayStr ?? "", 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const d = new Date(Date.UTC(year, month - 1, day));
	if (Number.isNaN(d.getTime())) return false;
	return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function warnMalformed(label: string, rawValue: string, itemTitle: string): void {
	// Use stderr to surface parse warnings without relying on console (which
	// is linted out of src/) and without requiring a pluggable logger.
	process.stderr.write(`[roadmap-file] Ignoring malformed ${label} "${rawValue}" for roadmap item "${itemTitle}"\n`);
}

// ---------------------------------------------------------------------------
// V2 table-format parser
// ---------------------------------------------------------------------------

/** Column names we recognise in the Items table (lowercased for matching). */
const KNOWN_COLUMNS = new Map<string, string>([
	["id", "id"],
	["poc", "owner"],
	["title", "title"],
	["description", "description"],
	["goal (exit criteria)", "goal"],
	["goal", "goal"],
	["spec", "spec"],
	["status", "status"],
	["launch date", "launchDate"],
]);

/**
 * Detect whether `content` uses the V2 table format.
 * Looks for a `## Items` heading followed (within a few lines) by a
 * pipe-delimited table header row.
 */
function isTableFormat(content: string): boolean {
	const itemsIdx = content.search(/^## Items\b/m);
	if (itemsIdx === -1) return false;
	// Check the next ~5 non-empty lines after ## Items for a table header
	const afterItems = content.slice(itemsIdx);
	const lines = afterItems.split("\n").slice(1, 8);
	return lines.some((l) => /^\|.*\|$/.test(l.trim()));
}

/**
 * Parse the V2 table-based ROADMAP.md into RuntimeRoadmapItem[].
 *
 * Handles:
 * - `## Introduction` section (stored as context but not mapped to items)
 * - `## Items` markdown table with known + unknown columns
 * - `## Comments` global blockquote comments (attached to every item)
 */
export function parseRoadmapTable(content: string): RuntimeRoadmapItem[] {
	// --- Split into top-level ## sections ---
	const sectionMap = parseH2Sections(content);

	// --- Parse introduction ---
	const _intro = (sectionMap.get("introduction") ?? "").trim();

	// --- Parse comments ---
	const globalComments = parseGlobalComments(sectionMap.get("comments") ?? "");

	// --- Parse the items table ---
	const itemsRaw = sectionMap.get("items") ?? "";
	const tableLines = itemsRaw
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("|"));

	if (tableLines.length < 2) return [];

	// First line = header, second = separator (skip it), rest = data rows
	const headerLine = tableLines[0] ?? "";
	const columnNames = splitTableRow(headerLine);

	// Map column positions to known field keys
	const columnMapping: Array<string | null> = columnNames.map((name) => {
		return KNOWN_COLUMNS.get(name.toLowerCase().trim()) ?? null;
	});

	const items: RuntimeRoadmapItem[] = [];

	for (let i = 2; i < tableLines.length; i++) {
		const row = tableLines[i] ?? "";
		// Skip separator-like rows
		if (/^\|[\s-|]+\|$/.test(row)) continue;

		const cells = splitTableRow(row);
		const cellMap = new Map<string, string>();
		for (let col = 0; col < columnMapping.length; col++) {
			const key = columnMapping[col];
			if (key) {
				cellMap.set(key, unescapeTableCell(cells[col] ?? "").trim());
			}
		}

		const rawTitle = cellMap.get("title") ?? "";
		if (!rawTitle) continue;

		// ID: prefix bare numbers with roadmap_
		let id = cellMap.get("id") ?? "";
		if (!id) {
			id = `roadmap_${crypto.randomUUID()}`;
		} else if (/^\d+$/.test(id)) {
			id = `roadmap_${id}`;
		}

		const owner = cellMap.get("owner") || undefined;
		const description = cellMap.get("description") ?? "";
		const goal = cellMap.get("goal") ?? "";
		const status = parseStatus(cellMap.get("status") ?? "");

		// Launch Date → endDate
		const rawLaunchDate = cellMap.get("launchDate") ?? "";
		const endDate = isValidIsoDate(rawLaunchDate) ? rawLaunchDate : undefined;

		// Spec → extract slug from [spec](specs/<slug>/) or [spec](specs/<slug>)
		const specSlug = extractSpecSlug(cellMap.get("spec") ?? "");

		const ts = Date.now();
		items.push({
			id,
			title: rawTitle,
			description,
			status,
			...(owner ? { owner, poc: owner } : {}),
			...(goal ? { goal } : {}),
			...(specSlug ? { specSlug } : {}),
			...(endDate ? { endDate } : {}),
			openQuestions: [],
			tasks: [],
			linkedTaskIds: [],
			comments: [...globalComments],
			createdAt: ts,
			updatedAt: ts,
		});
	}

	return items;
}

/**
 * Split content into a Map of lowercase heading → body text for each `## Heading` section.
 */
function parseH2Sections(content: string): Map<string, string> {
	const map = new Map<string, string>();
	const parts = content.split(/^## /m);
	// parts[0] is content before the first ##, skip it
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i] ?? "";
		const newlineIdx = part.indexOf("\n");
		if (newlineIdx === -1) {
			map.set(part.trim().toLowerCase(), "");
		} else {
			const heading = part.slice(0, newlineIdx).trim().toLowerCase();
			const body = part.slice(newlineIdx + 1);
			map.set(heading, body);
		}
	}
	return map;
}

/**
 * Split a markdown table row (e.g. `| a | b | c |`) into cell values.
 * Handles escaped pipes `\|` inside cells.
 */
function splitTableRow(row: string): string[] {
	// Remove leading/trailing pipe and whitespace
	let inner = row.trim();
	if (inner.startsWith("|")) inner = inner.slice(1);
	if (inner.endsWith("|")) inner = inner.slice(0, -1);

	// Split on unescaped pipes: we replace \| temporarily
	const placeholder = "\x00PIPE\x00";
	const escaped = inner.replace(/\\\|/g, placeholder);
	return escaped.split("|").map((cell) => cell.replace(new RegExp(placeholder, "g"), "|").trim());
}

/** Reverse `escapeTableCell` — restore pipes and (limited) newlines. */
function unescapeTableCell(value: string): string {
	return value.replace(/\\\|/g, "|");
}

/** Extract a spec slug from `[spec](specs/<slug>/)` or `[text](specs/<slug>)`. */
function extractSpecSlug(value: string): string | undefined {
	const match = value.match(/\[.*?]\(specs\/([^/)]+)\/?.*?\)/);
	return match?.[1] ?? undefined;
}

/** Parse global `## Comments` blockquotes into comment objects. */
function parseGlobalComments(body: string): Array<{ id: string; text: string; createdAt: number }> {
	const comments: Array<{ id: string; text: string; createdAt: number }> = [];
	for (const line of body.split("\n")) {
		const match = line.trim().match(/^> \[(.+?)] (.+)$/);
		if (match?.[2]) {
			comments.push({
				id: crypto.randomUUID(),
				text: match[2],
				createdAt: new Date(match[1] ?? "").getTime() || Date.now(),
			});
		}
	}
	return comments;
}

// ---------------------------------------------------------------------------
// V1 per-item parser
// ---------------------------------------------------------------------------

/**
 * Parse a ROADMAP.md file. Automatically detects whether the content uses
 * the V2 table format or the V1 per-item format and dispatches accordingly.
 */
export function parseRoadmapMarkdown(content: string): RuntimeRoadmapItem[] {
	if (isTableFormat(content)) {
		return parseRoadmapTable(content);
	}
	return parseRoadmapMarkdownV1(content);
}

function parseRoadmapMarkdownV1(content: string): RuntimeRoadmapItem[] {
	const items: RuntimeRoadmapItem[] = [];
	const sections = content.split(/^## /m).slice(1);

	for (const section of sections) {
		const lines = section.split("\n");
		const title = (lines[0] ?? "").trim();
		if (!title) continue;

		let status: RuntimeRoadmapItemStatus = "planned";
		let explicitId: string | null = null;
		let version: number | undefined;
		let owner: string | undefined;
		let startDate: string | undefined;
		let endDate: string | undefined;
		let milestone: boolean | undefined;
		const descLines: string[] = [];
		const comments: Array<{ id: string; text: string; createdAt: number }> = [];
		const linkedTaskIds: string[] = [];
		const tasks: Array<{ taskId: string; title: string; agentCreated?: boolean }> = [];
		const openQuestions: Array<{ id: string; text: string; resolved: boolean }> = [];
		const sectionLines = { requirements: [] as string[], design: [] as string[] };

		type Section =
			| "none"
			| "requirements"
			| "design"
			| "tasks"
			| "comments"
			| "openquestions"
			| "legacy_tasks"
			| "legacy_comments";
		let currentSection: Section = "none";

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const trimmed = line.trim();
			if (trimmed === "---") break;

			// Metadata lines (only in "none" section, before any ### heading)
			if (currentSection === "none") {
				if (trimmed.startsWith("**ID:**")) {
					const match = trimmed.match(/\*\*ID:\*\*\s*`([^`]+)`/);
					if (match?.[1]) explicitId = match[1];
					continue;
				}
				if (trimmed.startsWith("**Status:**")) {
					status = parseStatus(trimmed);
					continue;
				}
				if (trimmed.startsWith("**Version:**")) {
					const match = trimmed.match(/\*\*Version:\*\*\s*(\d+)/);
					if (match?.[1]) version = Number.parseInt(match[1], 10);
					continue;
				}
				if (trimmed.startsWith("**Owner:**")) {
					owner = trimmed.replace(/^\*\*Owner:\*\*\s*/, "").trim() || undefined;
					continue;
				}
				if (trimmed.startsWith("**Start:**")) {
					const raw = trimmed.replace(/^\*\*Start:\*\*\s*/, "").trim();
					if (raw === "") {
						// Explicitly empty — treat as absent, no warning.
					} else if (isValidIsoDate(raw)) {
						startDate = raw;
					} else {
						warnMalformed("Start date", raw, title);
					}
					continue;
				}
				if (trimmed.startsWith("**End:**")) {
					const raw = trimmed.replace(/^\*\*End:\*\*\s*/, "").trim();
					if (raw === "") {
						// Explicitly empty — treat as absent, no warning.
					} else if (isValidIsoDate(raw)) {
						endDate = raw;
					} else {
						warnMalformed("End date", raw, title);
					}
					continue;
				}
				if (trimmed.startsWith("**Milestone:**")) {
					const raw = trimmed
						.replace(/^\*\*Milestone:\*\*\s*/, "")
						.trim()
						.toLowerCase();
					if (raw === "true" || raw === "yes") {
						milestone = true;
					} else if (raw === "false" || raw === "no" || raw === "") {
						milestone = false;
					} else {
						warnMalformed("Milestone flag", raw, title);
					}
					continue;
				}
			}

			// Detect ### subsection headings
			if (trimmed.startsWith("### ")) {
				const heading = trimmed.slice(4).trim().toLowerCase();
				if (heading === "requirements") {
					currentSection = "requirements";
					continue;
				}
				if (heading === "design") {
					currentSection = "design";
					continue;
				}
				if (heading === "tasks") {
					currentSection = "tasks";
					continue;
				}
				if (heading === "comments") {
					currentSection = "comments";
					continue;
				}
				if (heading === "open questions") {
					currentSection = "openquestions";
					continue;
				}
				// Unknown ### heading — treat as description content
				if (currentSection === "none") descLines.push(trimmed);
				continue;
			}

			// Legacy bold-section headers (back compat with M1 format)
			if (trimmed === "**Tasks:**") {
				currentSection = "legacy_tasks";
				continue;
			}
			if (trimmed === "**Linked Tasks:**") {
				currentSection = "legacy_tasks";
				continue;
			}
			if (trimmed === "**Comments:**") {
				currentSection = "legacy_comments";
				continue;
			}

			// Route content to the right bucket
			switch (currentSection) {
				case "none":
					if (trimmed) descLines.push(line);
					break;
				case "requirements":
					sectionLines.requirements.push(line);
					break;
				case "design":
					sectionLines.design.push(line);
					break;
				case "tasks":
				case "legacy_tasks": {
					const match = trimmed.match(/^-\s*\[[ x~]\]\s*`([^`]+)`\s*(.*)$/);
					if (match?.[1]) {
						const taskId = match[1];
						const rest = (match[2] ?? "").trim();
						const agentCreated = /_\(agent-created\)_/i.test(rest);
						const taskTitle = rest.replace(/\s*_\(agent-created\)_\s*$/i, "").trim();
						tasks.push({ taskId, title: taskTitle, ...(agentCreated ? { agentCreated: true } : {}) });
						linkedTaskIds.push(taskId);
					} else if (currentSection === "legacy_tasks") {
						const legacyMatch = trimmed.match(/^- `(.+)`$/);
						if (legacyMatch?.[1]) linkedTaskIds.push(legacyMatch[1]);
					}
					break;
				}
				case "comments":
				case "legacy_comments": {
					const match = trimmed.match(/^> \[(.+?)] (.+)$/);
					if (match?.[2]) {
						comments.push({
							id: crypto.randomUUID(),
							text: match[2],
							createdAt: new Date(match[1] ?? "").getTime() || Date.now(),
						});
					}
					break;
				}
				case "openquestions": {
					const match = trimmed.match(/^-\s*\[([ x])\]\s*(.+)$/);
					if (match?.[2]) {
						openQuestions.push({
							id: crypto.randomUUID(),
							text: match[2],
							resolved: match[1] === "x",
						});
					}
					break;
				}
			}
		}

		// Trim trailing empty lines from section content.
		// V1 format stored requirements/design inline; fold into description
		// for backward compatibility since those fields are removed from the schema.
		const requirementsContent = trimSectionContent(sectionLines.requirements);
		const designContent = trimSectionContent(sectionLines.design);

		const descParts = [descLines.join("\n").trim()];
		if (requirementsContent) {
			descParts.push(`### Requirements\n\n${requirementsContent}`);
		}
		if (designContent) {
			descParts.push(`### Design\n\n${designContent}`);
		}
		const finalDescription = descParts.filter(Boolean).join("\n\n");

		const ts = Date.now();
		items.push({
			id: explicitId ?? `roadmap_${crypto.randomUUID()}`,
			title,
			description: finalDescription,
			status,
			...(version != null ? { version } : {}),
			...(owner ? { owner } : {}),
			...(startDate ? { startDate } : {}),
			...(endDate ? { endDate } : {}),
			...(milestone != null ? { milestone } : {}),
			openQuestions,
			tasks,
			linkedTaskIds,
			comments,
			createdAt: ts,
			updatedAt: ts,
		});
	}

	return items;
}

function trimSectionContent(lines: string[]): string | undefined {
	let start = 0;
	while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
	let end = lines.length;
	while (end > start && (lines[end - 1] ?? "").trim() === "") end--;
	if (start >= end) return undefined;
	return lines.slice(start, end).join("\n");
}

// ---------------------------------------------------------------------------
// V1 → V2 migration
// ---------------------------------------------------------------------------

/**
 * Convert a V1 per-item ROADMAP.md to the V2 table format.
 * Parses with the V1 parser and re-serializes with the V2 table serializer.
 */
export function migrateRoadmapV1ToV2(content: string): string {
	const items = parseRoadmapMarkdownV1(content);
	return serializeRoadmapTable(items);
}

// ---------------------------------------------------------------------------
// Import parser (best-effort, arbitrary text)
// ---------------------------------------------------------------------------

/**
 * Best-effort parse of arbitrary text (not our format) into roadmap items.
 * Handles numbered lists, markdown headings, and bullet points.
 */
export function parseImportedText(content: string): RuntimeRoadmapItem[] {
	// Try our own format first (V2 table or V1 per-item)
	if (isTableFormat(content)) {
		return parseRoadmapTable(content);
	}
	if (content.includes("## ") && content.includes("**Status:**")) {
		return parseRoadmapMarkdownV1(content);
	}

	const items: RuntimeRoadmapItem[] = [];
	// Split by headings (## or ###) or numbered lines (1. 2. etc)
	const blocks = content.split(/(?=^#{1,3} |\n(?=\d+\.\s))/m).filter((b) => b.trim());

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		let title = (lines[0] ?? "")
			.replace(/^#{1,3}\s*/, "")
			.replace(/^\d+\.\s*/, "")
			.trim();
		if (!title) continue;
		// Cap title length, rest goes to description
		if (title.length > 120) {
			title = title.slice(0, 120);
		}
		const descLines = lines
			.slice(1)
			.map((l) => l.replace(/^[-*]\s*/, "").trim())
			.filter(Boolean);
		const ts = Date.now();
		items.push({
			id: crypto.randomUUID(),
			title,
			description: descLines.join("\n"),
			status: "planned",
			openQuestions: [],
			tasks: [],
			linkedTaskIds: [],
			comments: [],
			createdAt: ts,
			updatedAt: ts,
		});
	}

	// Fallback: if no structure found, treat each non-empty line as an item
	if (items.length === 0) {
		for (const line of content.split("\n")) {
			const trimmed = line
				.replace(/^[-*]\s*/, "")
				.replace(/^\d+\.\s*/, "")
				.trim();
			if (!trimmed) continue;
			const ts = Date.now();
			items.push({
				id: crypto.randomUUID(),
				title: trimmed.slice(0, 120),
				description: trimmed.length > 120 ? trimmed : "",
				status: "planned",
				openQuestions: [],
				tasks: [],
				linkedTaskIds: [],
				comments: [],
				createdAt: ts,
				updatedAt: ts,
			});
		}
	}

	return items;
}
