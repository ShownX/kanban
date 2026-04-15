// Builds the view model for the native Cline chat panel.
// Keep panel-specific UI state here so the panel component can stay mostly
// declarative and shared across detail and sidebar surfaces.
import { useCallback, useEffect, useState } from "react";

import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import { type ClineChatMessage, useClineChatSession } from "@/hooks/use-cline-chat-session";
import type { RuntimeTaskImage, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";

interface UseClineChatPanelControllerInput {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
	taskColumnId?: string;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<ClineChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessages?: ClineChatMessage[] | null;
	incomingMessage?: ClineChatMessage | null;
	onCommit?: () => void;
	onOpenPr?: () => void;
	onMoveToTrash?: () => void;
	onCancelAutomaticAction?: () => void;
	cancelAutomaticActionLabel?: string | null;
	showMoveToTrash?: boolean;
}

interface UseClineChatPanelControllerResult {
	draft: string;
	setDraft: (draft: string) => void;
	messages: ClineChatMessage[];
	error: string | null;
	isSending: boolean;
	isCanceling: boolean;
	canSend: boolean;
	canCancel: boolean;
	showReviewActions: boolean;
	showAgentProgressIndicator: boolean;
	showActionFooter: boolean;
	showCancelAutomaticAction: boolean;
	handleSendText: (text: string, mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
	handleSendDraft: (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
	handleCancelTurn: () => void;
}

function isTurnResponseMessage(message: ClineChatMessage | null): boolean {
	return (
		message?.role === "assistant" ||
		message?.role === "reasoning" ||
		message?.role === "tool" ||
		message?.role === "system" ||
		message?.role === "status"
	);
}

function getTurnStartTimestamp(summary: RuntimeTaskSessionSummary | null): number | null {
	if (summary?.state !== "running" || summary.latestHookActivity?.hookEventName !== "turn_start") {
		return null;
	}
	return summary.lastHookAt ?? summary.updatedAt ?? null;
}

function hasSummaryTurnResponse(summary: RuntimeTaskSessionSummary | null): boolean {
	if (summary?.state !== "running") {
		return false;
	}

	const hookEventName = summary.latestHookActivity?.hookEventName ?? null;
	return hookEventName !== null && hookEventName !== "turn_start";
}

function isCurrentTurnResponseMessage(message: ClineChatMessage | null, turnStartTimestamp: number | null): boolean {
	if (message === null || !isTurnResponseMessage(message)) {
		return false;
	}
	if (turnStartTimestamp === null) {
		return true;
	}
	return message.createdAt >= turnStartTimestamp;
}

function hasCurrentTurnResponseInMessages(
	messages: ClineChatMessage[] | null,
	turnStartTimestamp: number | null,
): boolean {
	return messages?.some((message) => isCurrentTurnResponseMessage(message, turnStartTimestamp)) ?? false;
}

function useHasSeenCurrentTurnResponse(
	messages: ClineChatMessage[],
	summary: RuntimeTaskSessionSummary | null,
	incomingMessages: ClineChatMessage[] | null,
	incomingMessage: ClineChatMessage | null,
): boolean {
	const turnStartTimestampFromSummary = getTurnStartTimestamp(summary);
	const [turnStartTimestamp, setTurnStartTimestamp] = useState<number | null>(() => turnStartTimestampFromSummary);
	const effectiveTurnStartTimestamp = turnStartTimestampFromSummary ?? turnStartTimestamp;
	const hasIncomingResponse =
		isCurrentTurnResponseMessage(incomingMessage, effectiveTurnStartTimestamp) ||
		hasCurrentTurnResponseInMessages(incomingMessages, effectiveTurnStartTimestamp) ||
		hasCurrentTurnResponseInMessages(messages, effectiveTurnStartTimestamp);
	const hasSummaryResponse = hasSummaryTurnResponse(summary);
	const [hasSeenCurrentTurnResponse, setHasSeenCurrentTurnResponse] = useState(
		() => isTurnResponseMessage(incomingMessage) || hasSummaryResponse,
	);

	useEffect(() => {
		if (summary?.state !== "running") {
			setTurnStartTimestamp(null);
			setHasSeenCurrentTurnResponse(false);
			return;
		}

		if (turnStartTimestampFromSummary !== null) {
			setTurnStartTimestamp(turnStartTimestampFromSummary);
			setHasSeenCurrentTurnResponse(hasIncomingResponse || hasSummaryResponse);
		} else if (hasIncomingResponse || hasSummaryResponse) {
			setHasSeenCurrentTurnResponse(true);
		}
	}, [hasIncomingResponse, hasSummaryResponse, summary?.state, turnStartTimestampFromSummary]);

	return hasSeenCurrentTurnResponse || hasIncomingResponse || hasSummaryResponse;
}

export function useClineChatPanelController({
	taskId,
	summary,
	taskColumnId = "in_progress",
	onSendMessage,
	onCancelTurn,
	onLoadMessages,
	incomingMessages = null,
	incomingMessage = null,
	onCommit,
	onOpenPr,
	onMoveToTrash,
	onCancelAutomaticAction,
	cancelAutomaticActionLabel,
	showMoveToTrash = false,
}: UseClineChatPanelControllerInput): UseClineChatPanelControllerResult {
	const [draft, setDraft] = useState("");
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(taskId);
	const { messages, isSending, isCanceling, error, sendMessage, cancelTurn } = useClineChatSession({
		taskId,
		onSendMessage,
		onCancelTurn,
		onLoadMessages,
		incomingMessages,
		incomingMessage,
	});
	const canSend = Boolean(onSendMessage) && !isSending && !isCanceling;
	const canCancel = Boolean(onCancelTurn) && summary?.state === "running" && !isCanceling;
	const showReviewActions =
		taskColumnId === "review" &&
		(reviewWorkspaceSnapshot?.changedFiles ?? 0) > 0 &&
		Boolean(onCommit) &&
		Boolean(onOpenPr);
	const hasSeenCurrentTurnResponse = useHasSeenCurrentTurnResponse(
		messages,
		summary,
		incomingMessages,
		incomingMessage,
	);
	const showAgentProgressIndicator = summary?.state === "running" && !hasSeenCurrentTurnResponse;
	const showActionFooter = showMoveToTrash && Boolean(onMoveToTrash);
	const showCancelAutomaticAction = Boolean(cancelAutomaticActionLabel && onCancelAutomaticAction);

	const handleSendText = useCallback(
		async (text: string, mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]): Promise<boolean> => {
			return sendMessage(
				text,
				mode || images?.length
					? {
							...(mode ? { mode } : {}),
							...(images?.length ? { images } : {}),
						}
					: undefined,
			);
		},
		[sendMessage],
	);

	const handleSendDraft = useCallback(
		async (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]): Promise<boolean> => {
			const sent = await handleSendText(draft, mode, images);
			if (sent) {
				setDraft("");
			}
			return sent;
		},
		[draft, handleSendText],
	);

	const handleCancelTurn = useCallback(() => {
		void cancelTurn();
	}, [cancelTurn]);

	return {
		draft,
		setDraft,
		messages,
		error,
		isSending,
		isCanceling,
		canSend,
		canCancel,
		showReviewActions,
		showAgentProgressIndicator,
		showActionFooter,
		showCancelAutomaticAction,
		handleSendText,
		handleSendDraft,
		handleCancelTurn,
	};
}
