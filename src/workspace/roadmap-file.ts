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
		lines.push(`**Status:** ${formatStatus(item.status)}\n`);
		if (item.description) {
			lines.push(`${item.description}\n`);
		}
		if (item.linkedTaskIds.length > 0) {
			lines.push("**Linked Tasks:**");
			for (const taskId of item.linkedTaskIds) {
				lines.push(`- \`${taskId}\``);
			}
			lines.push("");
		}
		if (item.comments.length > 0) {
			lines.push("**Comments:**");
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
		const descLines: string[] = [];
		const comments: Array<{ id: string; text: string; createdAt: number }> = [];
		const linkedTaskIds: string[] = [];
		let inComments = false;
		let inLinkedTasks = false;

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const trimmed = line.trim();
			if (trimmed === "---") break;

			if (trimmed.startsWith("**Status:**")) {
				status = parseStatus(trimmed);
				continue;
			}
			if (trimmed === "**Linked Tasks:**") {
				inLinkedTasks = true;
				inComments = false;
				continue;
			}
			if (trimmed === "**Comments:**") {
				inComments = true;
				inLinkedTasks = false;
				continue;
			}
			if (inLinkedTasks) {
				const match = trimmed.match(/^- `(.+)`$/);
				if (match?.[1]) linkedTaskIds.push(match[1]);
				continue;
			}
			if (inComments) {
				const match = trimmed.match(/^> \[(.+?)] (.+)$/);
				if (match?.[2]) {
					comments.push({
						id: crypto.randomUUID(),
						text: match[2],
						createdAt: new Date(match[1] ?? "").getTime() || Date.now(),
					});
				}
				continue;
			}
			if (trimmed) descLines.push(trimmed);
		}

		const ts = Date.now();
		items.push({
			id: crypto.randomUUID(),
			title,
			description: descLines.join("\n"),
			status,
			linkedTaskIds,
			comments,
			createdAt: ts,
			updatedAt: ts,
		});
	}

	return items;
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
				linkedTaskIds: [],
				comments: [],
				createdAt: ts,
				updatedAt: ts,
			});
		}
	}

	return items;
}
