import { AlertTriangle, Clock, FileText } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/components/ui/cn";
import { MarkdownCodeBlock } from "@/components/ui/markdown-code-block";
import { Spinner } from "@/components/ui/spinner";
import type { ChangelogEntry } from "./use-shared-memory";
import { useSharedMemory } from "./use-shared-memory";

type MemoryTab = "changelog" | "interfaces" | "decisions";

const MEMORY_TABS: { id: MemoryTab; label: string }[] = [
	{ id: "changelog", label: "Changelog" },
	{ id: "interfaces", label: "Interfaces" },
	{ id: "decisions", label: "Decisions" },
];

const CHANGELOG_PAGE_SIZE = 100;

/** Markdown styling classes shared with spec-tab */
const MARKDOWN_CLASSES =
	"[&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-text-secondary [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ul]:text-sm [&_ul]:text-text-secondary [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_ol]:text-sm [&_ol]:text-text-secondary [&_ol]:space-y-1 [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-text-primary [&_em]:italic [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:mb-3 [&_blockquote]:text-sm [&_blockquote]:italic [&_blockquote]:text-text-tertiary [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_table]:mb-3 [&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-text-primary [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:text-text-secondary [&_hr]:border-border [&_hr]:my-4";

interface SharedMemoryPanelProps {
	workspaceId: string | null;
}

export function SharedMemoryPanel({ workspaceId }: SharedMemoryPanelProps): ReactElement {
	const { changelog, interfaces, decisions, isLoading } = useSharedMemory(workspaceId);
	const [activeTab, setActiveTab] = useState<MemoryTab>("changelog");

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner size={24} className="text-text-tertiary" />
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col min-h-0">
			{/* Sub-tabs */}
			<div className="flex items-center gap-1 border-b border-border px-4 py-1.5">
				{MEMORY_TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"shrink-0 px-2 py-1 text-xs font-medium rounded",
							activeTab === tab.id
								? "bg-surface-3 text-text-primary"
								: "text-text-secondary hover:text-text-primary",
						)}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 min-h-0 overflow-y-auto bg-surface-0 p-6">
				<div className="px-8">
					{activeTab === "changelog" && <ChangelogTab entries={changelog} />}
					{activeTab === "interfaces" && <InterfacesTab content={interfaces} />}
					{activeTab === "decisions" && <DecisionsTab content={decisions} />}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Changelog tab
// ---------------------------------------------------------------------------

interface ChangelogTabProps {
	entries: ChangelogEntry[];
}

function ChangelogTab({ entries }: ChangelogTabProps): ReactElement {
	const [agentFilter, setAgentFilter] = useState<string>("__all__");
	const [visibleCount, setVisibleCount] = useState(CHANGELOG_PAGE_SIZE);

	const agentNames = useMemo(() => {
		const names = new Set<string>();
		for (const entry of entries) {
			names.add(entry.agent);
		}
		return Array.from(names).sort();
	}, [entries]);

	const filtered = useMemo(() => {
		const base = agentFilter === "__all__" ? entries : entries.filter((e) => e.agent === agentFilter);
		// Reverse chronological order (newest first)
		return [...base].reverse();
	}, [entries, agentFilter]);

	const visible = filtered.slice(0, visibleCount);
	const hasMore = visibleCount < filtered.length;

	if (entries.length === 0) {
		return <p className="text-text-tertiary text-sm text-center py-16">No changelog entries yet.</p>;
	}

	return (
		<div className="space-y-2">
			{/* Filter */}
			{agentNames.length > 1 && (
				<div className="mb-3">
					<select
						value={agentFilter}
						onChange={(e) => {
							setAgentFilter(e.target.value);
							setVisibleCount(CHANGELOG_PAGE_SIZE);
						}}
						className="h-7 rounded border border-border bg-surface-2 px-2 text-xs text-text-primary outline-none"
					>
						<option value="__all__">All agents</option>
						{agentNames.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Entries */}
			{visible.map((entry, idx) => (
				<ChangelogRow key={`${entry.ts}-${idx}`} entry={entry} />
			))}

			{/* Load more */}
			{hasMore && (
				<button
					type="button"
					onClick={() => setVisibleCount((prev) => prev + CHANGELOG_PAGE_SIZE)}
					className="mt-2 text-xs text-accent hover:text-accent-hover"
				>
					Load more ({filtered.length - visibleCount} remaining)
				</button>
			)}
		</div>
	);
}

function ChangelogRow({ entry }: { entry: ChangelogEntry }): ReactElement {
	const formattedTime = useMemo(() => {
		try {
			const date = new Date(entry.ts);
			return date.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return entry.ts;
		}
	}, [entry.ts]);

	const summary = entry.summary ?? entry.decision ?? entry.detail ?? "";

	return (
		<div
			className={cn(
				"flex flex-col gap-1 rounded-md bg-surface-1 px-3 py-2 text-xs",
				entry.needsPmReview && "border-l-2 border-status-orange",
			)}
		>
			{/* Top row: timestamp + agent badge + event type */}
			<div className="flex items-center gap-2">
				<span className="flex items-center gap-1 text-text-tertiary shrink-0">
					<Clock size={12} />
					{formattedTime}
				</span>
				<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
					{entry.agent}
				</span>
				<span className="text-text-secondary">{formatEventType(entry.event)}</span>
				{entry.needsPmReview && (
					<span className="flex items-center gap-0.5 text-status-orange shrink-0" title="Needs PM review">
						<AlertTriangle size={12} />
					</span>
				)}
			</div>

			{/* Summary */}
			{summary && <p className="text-text-secondary leading-relaxed">{summary}</p>}

			{/* File paths */}
			{entry.files && entry.files.length > 0 && (
				<div className="flex flex-wrap items-center gap-1 mt-0.5">
					<FileText size={12} className="text-text-tertiary shrink-0" />
					{entry.files.map((file) => (
						<code
							key={file}
							className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-text-secondary"
						>
							{file}
						</code>
					))}
				</div>
			)}

			{/* Rationale (if present, e.g. for decisions) */}
			{entry.rationale && <p className="text-text-tertiary italic mt-0.5">{entry.rationale}</p>}
		</div>
	);
}

function formatEventType(event: string): string {
	return event.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Interfaces tab
// ---------------------------------------------------------------------------

interface InterfacesTabProps {
	content: string;
}

function InterfacesTab({ content }: InterfacesTabProps): ReactElement {
	if (!content.trim()) {
		return <p className="text-text-tertiary text-sm text-center py-16">No interface contracts defined.</p>;
	}

	return (
		<div className={MARKDOWN_CLASSES}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCodeBlock as never }}>
				{content}
			</ReactMarkdown>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Decisions tab
// ---------------------------------------------------------------------------

interface DecisionsTabProps {
	content: string;
}

function DecisionsTab({ content }: DecisionsTabProps): ReactElement {
	if (!content.trim()) {
		return <p className="text-text-tertiary text-sm text-center py-16">No decisions recorded.</p>;
	}

	return (
		<div className={MARKDOWN_CLASSES}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCodeBlock as never }}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
