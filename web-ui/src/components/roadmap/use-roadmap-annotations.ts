import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardData } from "@/types";
import { injectHighlightMarkers, stripMarkerChars } from "./comment-overlay";
import type { Annotation } from "./types";
import { createId, HIGHLIGHT_COLORS, now } from "./types";

interface UseRoadmapAnnotationsArgs {
	board: BoardData;
	onBoardChange: (board: BoardData) => void;
	markdown: string;
	markdownRef: React.RefObject<HTMLDivElement | null>;
}

interface UseRoadmapAnnotationsResult {
	annotations: Annotation[];
	activeAnnotations: Annotation[];
	highlightedMarkdown: string;
	activeId: string | null;
	setActiveId: (id: string | null) => void;
	pendingText: string | null;
	setPendingText: (text: string | null) => void;
	commentDraft: string;
	setCommentDraft: (text: string) => void;
	popover: { x: number; y: number; text: string } | null;
	setPopover: (popover: { x: number; y: number; text: string } | null) => void;
	handleClickMark: (id: string) => void;
	startComment: () => void;
	submitComment: () => void;
	deleteAnnotation: (id: string) => void;
	handleMouseUp: () => void;
	handleContextMenu: (e: React.MouseEvent) => void;
}

export function useRoadmapAnnotations({
	board,
	onBoardChange,
	markdown,
	markdownRef,
}: UseRoadmapAnnotationsArgs): UseRoadmapAnnotationsResult {
	const [annotations, setAnnotations] = useState<Annotation[]>(() => (board.roadmapAnnotations ?? []) as Annotation[]);

	// Persist annotations to board state whenever they change
	const boardRef = useRef(board);
	boardRef.current = board;
	const onBoardChangeRef = useRef(onBoardChange);
	onBoardChangeRef.current = onBoardChange;
	const prevAnnotationsRef = useRef(annotations);
	useEffect(() => {
		if (prevAnnotationsRef.current !== annotations) {
			prevAnnotationsRef.current = annotations;
			onBoardChangeRef.current({ ...boardRef.current, roadmapAnnotations: annotations });
		}
	}, [annotations]);

	const [pendingText, setPendingText] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	const [popover, setPopover] = useState<{ x: number; y: number; text: string } | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const nextColorIdx = useRef(0);

	// Pre-process markdown with highlight markers (skip resolved)
	const activeAnnotations = useMemo(() => annotations.filter((a) => !a.resolved), [annotations]);
	const highlightedMarkdown = useMemo(
		() => (activeAnnotations.length > 0 ? injectHighlightMarkers(markdown, activeAnnotations) : markdown),
		[markdown, activeAnnotations],
	);

	// Mark annotations as resolved when their text is no longer in the markdown
	useEffect(() => {
		let changed = false;
		const updated = annotations.map((a) => {
			if (a.resolved) return a;
			if (!markdown.includes(a.selectedText)) {
				changed = true;
				return { ...a, resolved: true };
			}
			return a;
		});
		if (changed) setAnnotations(updated);
	}, [markdown]); // eslint-disable-line react-hooks/exhaustive-deps

	// Persist annotations to board data
	useEffect(() => {
		const current = board.roadmapAnnotations ?? [];
		if (JSON.stringify(current) !== JSON.stringify(annotations)) {
			onBoardChange({ ...board, roadmapAnnotations: annotations });
		}
	}, [annotations]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync on annotation changes

	const handleClickMark = useCallback(
		(id: string) => {
			const ann = annotations.find((a) => a.id === id);
			if (ann) {
				setActiveId(id);
				// Position popup above the mark element
				const mark = markdownRef.current?.querySelector(`mark[data-ann-id="${id}"]`);
				if (mark) {
					const rect = mark.getBoundingClientRect();
					setPopover({ x: rect.left, y: rect.top, text: ann.selectedText });
				}
			}
		},
		[annotations, markdownRef],
	);

	// Dismiss popover on Escape key
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setPopover(null);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, []);

	const startComment = useCallback(() => {
		if (!popover) return;
		setPendingText(popover.text);
		setCommentDraft("");
		setPopover(null);
	}, [popover]);

	const submitComment = useCallback(() => {
		const text = commentDraft.trim();
		if (!text || !pendingText) return;
		const existing = activeId ? annotations.find((a) => a.id === activeId) : null;
		if (existing) {
			setAnnotations((prev) => prev.map((a) => (a.id === activeId ? { ...a, comment: text } : a)));
		} else {
			const color = HIGHLIGHT_COLORS[nextColorIdx.current % HIGHLIGHT_COLORS.length]!;
			nextColorIdx.current += 1;
			const ann: Annotation = { id: createId(), selectedText: pendingText, comment: text, createdAt: now(), color };
			setAnnotations((prev) => [...prev, ann]);
		}
		setPendingText(null);
		setCommentDraft("");
		setActiveId(null);
	}, [activeId, annotations, commentDraft, pendingText]);

	const deleteAnnotation = useCallback(
		(id: string) => {
			setAnnotations((prev) => prev.filter((a) => a.id !== id));
			if (activeId === id) setActiveId(null);
		},
		[activeId],
	);

	// Text selection — strip marker characters so the stored selectedText
	// matches the raw markdown and highlight injection works on future renders.
	const handleMouseUp = useCallback(() => {
		if (pendingText) return;
		const sel = window.getSelection();
		const rawText = sel?.toString().trim();
		if (!rawText || rawText.length < 2) {
			return;
		}
		const text = stripMarkerChars(rawText);
		if (!text || text.length < 2) return;
		const range = sel?.getRangeAt(0);
		if (!range) return;
		const rect = range.getBoundingClientRect();
		setPopover({ x: rect.left + rect.width / 2 - 50, y: rect.top, text });
	}, [pendingText]);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent) => {
			if (pendingText) return;
			e.preventDefault();
			const sel = window.getSelection();
			const rawSelectedText = sel?.toString().trim();
			if (rawSelectedText && rawSelectedText.length >= 2) {
				const text = stripMarkerChars(rawSelectedText);
				if (text.length >= 2) {
					setPopover({ x: e.clientX, y: e.clientY, text });
					return;
				}
			}
			const target = e.target as HTMLElement;
			const block = target.closest("p, h1, h2, h3, h4, li, td, th, blockquote");
			const rawContext = block?.textContent?.trim().slice(0, 80) || "general";
			setPopover({ x: e.clientX, y: e.clientY, text: stripMarkerChars(rawContext) });
		},
		[pendingText],
	);

	return {
		annotations,
		activeAnnotations,
		highlightedMarkdown,
		activeId,
		setActiveId,
		pendingText,
		setPendingText,
		commentDraft,
		setCommentDraft,
		popover,
		setPopover,
		handleClickMark,
		startComment,
		submitComment,
		deleteAnnotation,
		handleMouseUp,
		handleContextMenu,
	};
}
