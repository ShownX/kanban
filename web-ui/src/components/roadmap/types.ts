export interface Annotation {
	id: string;
	selectedText: string;
	comment: string;
	createdAt: number;
	color: string;
	resolved?: boolean;
}

export const HIGHLIGHT_COLORS = [
	"rgba(255, 209, 102, 0.35)",
	"rgba(120, 190, 255, 0.30)",
	"rgba(163, 113, 247, 0.30)",
	"rgba(63, 185, 80, 0.30)",
	"rgba(248, 81, 73, 0.25)",
];

export const MARK_OPEN = "«"; // «
export const MARK_CLOSE = "»"; // »
export const MARK_SEP = "‖"; // ‖

export type TabId = "roadmap" | "requirements" | "design" | "tasks" | "kpis" | "timeline" | "workspace" | "memory";

export function createId(): string {
	return crypto.randomUUID();
}

export function now(): number {
	return Date.now();
}
