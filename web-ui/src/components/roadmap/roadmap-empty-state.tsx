import { LayoutTemplate } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface TemplateSummary {
	id: string;
	name: string;
	description: string;
	itemCount: number;
}

interface RoadmapEmptyStateProps {
	workspaceId: string | null;
	/** Called after a template is successfully applied so the parent can reload roadmap data. */
	onTemplateApplied?: () => void;
}

export function RoadmapEmptyState({ workspaceId, onTemplateApplied }: RoadmapEmptyStateProps): ReactElement {
	const [templates, setTemplates] = useState<TemplateSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [applyingId, setApplyingId] = useState<string | null>(null);

	useEffect(() => {
		if (!workspaceId) {
			setLoading(false);
			return;
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		void trpc.runtime.listRoadmapTemplates
			.query()
			.then((result) => {
				setTemplates(result);
			})
			.catch(() => {
				// Silently fail — templates section just won't show.
			})
			.finally(() => {
				setLoading(false);
			});
	}, [workspaceId]);

	const handleApply = useCallback(
		(templateId: string) => {
			if (!workspaceId || applyingId) return;
			setApplyingId(templateId);
			const trpc = getRuntimeTrpcClient(workspaceId);
			void trpc.runtime.applyRoadmapTemplate
				.mutate({ templateId })
				.then((result) => {
					if (result.success) {
						toast.success("Template applied successfully");
						onTemplateApplied?.();
					} else {
						toast.error(result.error ?? "Failed to apply template");
					}
				})
				.catch(() => {
					toast.error("Failed to apply template");
				})
				.finally(() => {
					setApplyingId(null);
				});
		},
		[workspaceId, applyingId, onTemplateApplied],
	);

	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<p className="text-text-secondary text-sm max-w-sm">
				Your roadmap is empty. Use the <strong>Kanban agent</strong> in the left sidebar to generate a roadmap from
				your project description.
			</p>

			{/* Template picker */}
			{loading ? (
				<div className="mt-8">
					<Spinner size={20} />
				</div>
			) : templates.length > 0 ? (
				<div className="mt-8 w-full max-w-2xl">
					<div className="flex items-center justify-center gap-2 mb-4 text-text-secondary text-xs font-medium uppercase tracking-wide">
						<LayoutTemplate size={14} />
						<span>Or start from a template</span>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{templates.map((tmpl) => (
							<TemplateCard
								key={tmpl.id}
								template={tmpl}
								applying={applyingId === tmpl.id}
								disabled={applyingId !== null}
								onApply={handleApply}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

interface TemplateCardProps {
	template: TemplateSummary;
	applying: boolean;
	disabled: boolean;
	onApply: (id: string) => void;
}

function TemplateCard({ template, applying, disabled, onApply }: TemplateCardProps): ReactElement {
	return (
		<div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-1 p-4 text-left transition-colors hover:border-border-bright">
			<div className="flex items-center gap-2">
				<span className="text-sm font-medium text-text-primary">{template.name}</span>
				<span className="text-xs text-text-tertiary">
					{template.itemCount} {template.itemCount === 1 ? "item" : "items"}
				</span>
			</div>
			<p className="text-xs text-text-secondary leading-relaxed">{template.description}</p>
			<Button variant="default" size="sm" disabled={disabled} onClick={() => onApply(template.id)} className="mt-1">
				{applying ? <Spinner size={12} /> : "Apply"}
			</Button>
		</div>
	);
}
