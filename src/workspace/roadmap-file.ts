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

export function serializeRoadmap(items: RuntimeRoadmapItem[]): string {
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
		lines.push("");
		if (item.description) {
			lines.push(`${item.description}\n`);
		}
		if (item.requirements) {
			lines.push("### Requirements\n");
			lines.push(`${item.requirements}\n`);
		}
		if (item.design) {
			lines.push("### Design\n");
			lines.push(`${item.design}\n`);
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

export function parseRoadmapMarkdown(content: string): RuntimeRoadmapItem[] {
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
		const descLines: string[] = [];
		const comments: Array<{ id: string; text: string; createdAt: number }> = [];
		const linkedTaskIds: string[] = [];
		const tasks: Array<{ taskId: string; title: string; agentCreated?: boolean }> = [];
		const openQuestions: Array<{ id: string; text: string; resolved: boolean }> = [];
		const sectionLines: Record<string, string[]> = { requirements: [], design: [] };

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
			if (currentSection === "none" && trimmed === "**Tasks:**") {
				currentSection = "legacy_tasks";
				continue;
			}
			if (currentSection === "none" && trimmed === "**Linked Tasks:**") {
				currentSection = "legacy_tasks";
				continue;
			}
			if (currentSection === "none" && trimmed === "**Comments:**") {
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

		// Trim trailing empty lines from section content
		const requirements = trimSectionContent(sectionLines.requirements);
		const design = trimSectionContent(sectionLines.design);

		const ts = Date.now();
		items.push({
			id: explicitId ?? `roadmap_${crypto.randomUUID()}`,
			title,
			description: descLines.join("\n").trim(),
			status,
			...(version != null ? { version } : {}),
			...(owner ? { owner } : {}),
			...(requirements ? { requirements } : {}),
			...(design ? { design } : {}),
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

/**
 * Best-effort parse of arbitrary text (not our format) into roadmap items.
 * Handles numbered lists, markdown headings, and bullet points.
 */
export function parseImportedText(content: string): RuntimeRoadmapItem[] {
	// Try our own format first
	if (content.includes("## ") && content.includes("**Status:**")) {
		return parseRoadmapMarkdown(content);
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
