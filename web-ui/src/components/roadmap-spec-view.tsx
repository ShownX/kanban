import { ArrowLeft, CheckSquare, FileText, Layers } from "lucide-react";
import { type ReactElement, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RoadmapItem } from "@/types";

type SpecTab = "requirements" | "design" | "tasks";

interface RoadmapSpecViewProps {
	item: RoadmapItem;
	onBack: () => void;
}

const SPEC_TABS: Array<{ id: SpecTab; label: string; icon: ReactElement }> = [
	{ id: "requirements", label: "Requirements", icon: <FileText size={14} /> },
	{ id: "design", label: "Design", icon: <Layers size={14} /> },
	{ id: "tasks", label: "Tasks", icon: <CheckSquare size={14} /> },
];

export function RoadmapSpecView({ item, onBack }: RoadmapSpecViewProps): ReactElement {
	const [activeTab, setActiveTab] = useState<SpecTab>("requirements");

	const content = getTabContent(item, activeTab);

	return (
		<div className="flex flex-1 flex-col min-h-0 min-w-0">
			{/* Header */}
			<div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-3">
				<Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack} />
				<span className="text-sm font-medium text-text-primary truncate">{item.title}</span>
				{item.version != null ? <span className="text-[11px] text-text-tertiary">v{item.version}</span> : null}
			</div>

			{/* Tabs */}
			<div className="flex shrink-0 border-b border-border bg-surface-1 px-3">
				{SPEC_TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
							activeTab === tab.id
								? "border-accent text-accent"
								: "border-transparent text-text-secondary hover:text-text-primary",
						)}
					>
						{tab.icon}
						{tab.label}
						{tab.id === "tasks" && item.tasks.length > 0 ? (
							<span className="ml-1 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-tertiary">
								{item.tasks.length}
							</span>
						) : null}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto bg-surface-0 p-6">
				<div className="mx-auto" style={{ maxWidth: 720 }}>
					{content ? (
						<div className="prose-sm">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
						</div>
					) : (
						<EmptyState tab={activeTab} itemTitle={item.title} />
					)}
				</div>
			</div>
		</div>
	);
}

function getTabContent(item: RoadmapItem, tab: SpecTab): string | null {
	switch (tab) {
		case "requirements":
			return item.requirements || null;
		case "design":
			return item.design || null;
		case "tasks":
			return renderTasksMarkdown(item);
	}
}

function renderTasksMarkdown(item: RoadmapItem): string | null {
	if (item.tasks.length === 0) return null;
	const lines = item.tasks.map((ref) => {
		const agentTag = ref.agentCreated ? " _(agent-created)_" : "";
		return `- [ ] \`${ref.taskId}\` ${ref.title}${agentTag}`;
	});
	return lines.join("\n");
}

function EmptyState({ tab, itemTitle }: { tab: SpecTab; itemTitle: string }): ReactElement {
	const messages: Record<SpecTab, string> = {
		requirements: `No requirements defined yet for "${itemTitle}". Use the sidebar agent to generate requirements, or edit .kanban/ROADMAP.md directly and add a ### Requirements section under this item.`,
		design: `No design documented yet for "${itemTitle}". Use the sidebar agent to generate a design, or add a ### Design section under this item in .kanban/ROADMAP.md.`,
		tasks: `No tasks created yet for "${itemTitle}". Click "⚡ Generate tasks" in the Roadmap view to have the planner decompose this item into tasks.`,
	};

	return (
		<div className="flex flex-col items-center justify-center py-16 text-center">
			<p className="text-text-tertiary text-sm max-w-md">{messages[tab]}</p>
		</div>
	);
}
