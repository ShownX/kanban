import { type ReactElement, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface RoadmapCreateTaskDialogProps {
	open: boolean;
	roadmapItemTitle: string;
	onCancel: () => void;
	onConfirm: (input: { title: string; prompt: string }) => void;
}

/**
 * Minimal modal dialog for creating a single human-authored task linked
 * to a roadmap item. Intentionally small: title + prompt only. Baseline
 * branch, plan mode, auto-review etc. inherit the workspace defaults
 * and can be edited on the card afterward.
 */
export function RoadmapCreateTaskDialog({
	open,
	roadmapItemTitle,
	onCancel,
	onConfirm,
}: RoadmapCreateTaskDialogProps): ReactElement | null {
	const [title, setTitle] = useState("");
	const [prompt, setPrompt] = useState("");
	const titleInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			setTitle("");
			setPrompt("");
			window.setTimeout(() => titleInputRef.current?.focus(), 0);
		}
	}, [open]);

	if (!open) {
		return null;
	}

	const canSubmit = prompt.trim().length > 0;

	const handleSubmit = () => {
		if (!canSubmit) return;
		onConfirm({ title: title.trim(), prompt: prompt.trim() });
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Create task for roadmap item"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			onClick={onCancel}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					onCancel();
				}
			}}
		>
			<div
				className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-4 shadow-xl"
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<h2 className="text-sm font-semibold text-text-primary m-0">Create task</h2>
				<p className="text-text-tertiary text-xs mt-0.5 mb-3 truncate">
					Linked to: <span className="text-text-secondary">{roadmapItemTitle}</span>
				</p>

				<label className="block text-xs text-text-secondary mb-1" htmlFor="roadmap-task-title">
					Title (optional)
				</label>
				<input
					id="roadmap-task-title"
					ref={titleInputRef}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					className="mb-3 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
					placeholder="Derived from the prompt if empty"
				/>

				<label className="block text-xs text-text-secondary mb-1" htmlFor="roadmap-task-prompt">
					Prompt
				</label>
				<textarea
					id="roadmap-task-prompt"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					rows={5}
					className="mb-3 w-full resize-y rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
					placeholder="Describe the work for the agent to do…"
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							handleSubmit();
						}
					}}
				/>

				<div className="flex items-center justify-end gap-2">
					<Button size="sm" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button size="sm" variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
						Create
					</Button>
				</div>
			</div>
		</div>
	);
}
