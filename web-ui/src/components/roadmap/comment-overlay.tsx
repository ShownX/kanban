import { X } from "lucide-react";
import { createElement, type ReactElement } from "react";
import type { Annotation } from "./types";
import { MARK_CLOSE, MARK_OPEN, MARK_SEP } from "./types";

/** Inject highlight markers into raw markdown for each annotation. */
export function injectHighlightMarkers(md: string, annotations: Annotation[]): string {
	const replacements: Array<{ start: number; end: number; marker: string }> = [];
	for (const ann of annotations) {
		const idx = md.indexOf(ann.selectedText);
		if (idx === -1) continue;
		const marker = `${MARK_OPEN}${ann.id}${MARK_SEP}${ann.color}${MARK_SEP}${ann.selectedText}${MARK_CLOSE}`;
		replacements.push({ start: idx, end: idx + ann.selectedText.length, marker });
	}
	if (replacements.length === 0) return md;
	replacements.sort((a, b) => b.start - a.start);
	let result = md;
	for (const r of replacements) {
		result = result.slice(0, r.start) + r.marker + result.slice(r.end);
	}
	return result;
}

/** Strip highlight marker characters from text (for sanitizing DOM-selected text). */
export function stripMarkerChars(text: string): string {
	let result = text;
	const markerPattern = new RegExp(
		`${escapeRegex(MARK_OPEN)}[^${escapeRegex(MARK_CLOSE)}]*${escapeRegex(MARK_SEP)}[^${escapeRegex(MARK_CLOSE)}]*${escapeRegex(MARK_SEP)}([^${escapeRegex(MARK_CLOSE)}]*)${escapeRegex(MARK_CLOSE)}`,
		"g",
	);
	result = result.replace(markerPattern, "$1");
	result = result.replaceAll(MARK_OPEN, "").replaceAll(MARK_CLOSE, "").replaceAll(MARK_SEP, "");
	return result;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a text string that may contain highlight markers into React nodes. */
export function renderTextWithHighlights(
	text: string,
	activeId: string | null,
	onClickMark: (id: string) => void,
): Array<string | ReactElement> {
	const parts: Array<string | ReactElement> = [];
	let remaining = text;
	let key = 0;

	while (remaining.length > 0) {
		const openIdx = remaining.indexOf(MARK_OPEN);
		if (openIdx === -1) {
			parts.push(remaining);
			break;
		}
		if (openIdx > 0) {
			parts.push(remaining.slice(0, openIdx));
		}
		const closeIdx = remaining.indexOf(MARK_CLOSE, openIdx);
		if (closeIdx === -1) {
			parts.push(remaining.slice(openIdx));
			break;
		}
		const inner = remaining.slice(openIdx + 1, closeIdx);
		const sepFirst = inner.indexOf(MARK_SEP);
		const sepSecond = inner.indexOf(MARK_SEP, sepFirst + 1);
		if (sepFirst !== -1 && sepSecond !== -1) {
			const id = inner.slice(0, sepFirst);
			const color = inner.slice(sepFirst + 1, sepSecond);
			const highlightedText = inner.slice(sepSecond + 1);
			parts.push(
				<mark
					key={key++}
					data-ann-id={id}
					style={{
						backgroundColor: color,
						borderRadius: 2,
						padding: "1px 2px",
						cursor: "pointer",
						outline: activeId === id ? "2px solid var(--color-accent)" : undefined,
						outlineOffset: 1,
					}}
					onClick={() => onClickMark(id)}
				>
					{highlightedText}
				</mark>,
			);
		} else {
			parts.push(remaining.slice(openIdx, closeIdx + 1));
		}
		remaining = remaining.slice(closeIdx + 1);
	}
	return parts;
}

/** HOC that wraps a markdown component to parse highlight markers in its text children. */
export function withHighlights(
	Tag: keyof JSX.IntrinsicElements,
	className: string,
	activeId: string | null,
	onClickMark: (id: string) => void,
) {
	return function HighlightedComponent({ children }: { children?: React.ReactNode }) {
		const processed = processChildren(children, activeId, onClickMark);
		return createElement(Tag, { className }, processed);
	};
}

export function processChildren(
	children: React.ReactNode,
	activeId: string | null,
	onClickMark: (id: string) => void,
): React.ReactNode {
	if (typeof children === "string") {
		const parts = renderTextWithHighlights(children, activeId, onClickMark);
		return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
	}
	if (Array.isArray(children)) {
		return children.map((child, i) => {
			if (typeof child === "string") {
				const parts = renderTextWithHighlights(child, activeId, onClickMark);
				return parts.length === 1 && typeof parts[0] === "string" ? (
					<span key={i}>{parts[0]}</span>
				) : (
					<span key={i}>{parts}</span>
				);
			}
			return child;
		});
	}
	return children;
}

interface SelectionPopoverProps {
	popover: { x: number; y: number; text: string };
	onStartComment: (text: string) => void;
}

export function SelectionPopover({ popover, onStartComment }: SelectionPopoverProps): ReactElement {
	return (
		<div
			data-popover
			className="fixed z-50 rounded-md border border-border bg-surface-1 shadow-lg"
			style={{ left: popover.x, top: popover.y - 36 }}
			onMouseDown={(e) => e.preventDefault()}
		>
			<button
				type="button"
				className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-text-primary hover:bg-surface-3"
				onMouseDown={(e) => {
					e.preventDefault();
					onStartComment(popover.text || "(general comment)");
				}}
			>
				💬 Comment
			</button>
		</div>
	);
}

interface CommentCardProps {
	anchorText: string;
	relatedComments: Annotation[];
	commentDraft: string;
	onCommentDraftChange: (value: string) => void;
	onSubmitComment: () => void;
	onDeleteAnnotation: (id: string) => void;
	onDismiss: () => void;
	style: { left: number; top: number };
}

export function CommentCard({
	anchorText,
	relatedComments,
	commentDraft,
	onCommentDraftChange,
	onSubmitComment,
	onDeleteAnnotation,
	onDismiss,
	style,
}: CommentCardProps): ReactElement {
	return (
		<div
			className="fixed z-50 w-80 rounded-lg border border-border bg-surface-1 shadow-xl"
			style={{ left: style.left, top: style.top, transform: "translateY(-100%)" }}
		>
			{/* Header */}
			<div className="px-3 pt-3 pb-1">
				<p className="text-[11px] text-text-tertiary m-0 truncate">
					&ldquo;{anchorText.slice(0, 60)}
					{anchorText.length > 60 ? "…" : ""}&rdquo;
				</p>
			</div>
			{/* Previous comments */}
			{relatedComments.length > 0 && (
				<div className="px-3 py-1 space-y-1.5 max-h-[150px] overflow-y-auto">
					{relatedComments.map((c) => (
						<div key={c.id} className="flex items-start gap-1.5 group">
							<span className="shrink-0 w-1.5 h-1.5 mt-1 rounded-full" style={{ background: c.color }} />
							<p className="m-0 flex-1 text-xs text-text-primary">{c.comment}</p>
							<button
								type="button"
								onClick={() => onDeleteAnnotation(c.id)}
								className="shrink-0 opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-red"
							>
								<X size={10} />
							</button>
						</div>
					))}
				</div>
			)}
			{/* Input */}
			<div className="px-3 pb-3 pt-2 border-t border-border mt-1">
				<textarea
					rows={2}
					value={commentDraft}
					onChange={(e) => onCommentDraftChange(e.target.value)}
					placeholder="Add a comment…"
					className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-border-focus resize-none"
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							onSubmitComment();
						}
						if (e.key === "Escape") {
							onDismiss();
						}
					}}
				/>
				<div className="flex items-center justify-end mt-1.5 gap-1.5">
					<button
						type="button"
						onClick={onDismiss}
						className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary rounded"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onSubmitComment}
						disabled={!commentDraft.trim()}
						className="px-2 py-1 text-xs font-medium text-white bg-accent rounded disabled:opacity-40"
					>
						Add
					</button>
				</div>
			</div>
		</div>
	);
}
