import * as RadixPopover from "@radix-ui/react-popover";
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Bug,
	Check,
	ChevronDown,
	CircleArrowDown,
	Command,
	GitBranch,
	HelpCircle,
	Map as MapIcon,
	Menu,
	Play,
	Plus,
	Settings,
	Terminal,
} from "lucide-react";
import { useState } from "react";
import { OpenWorkspaceButton } from "@/components/open-workspace-button";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { RuntimeGitSyncAction, RuntimeProjectShortcut, RuntimeTokenUsage } from "@/runtime/types";
import {
	useHomeGitSummaryValue,
	useTaskWorkspaceInfoValue,
	useTaskWorkspaceSnapshotValue,
} from "@/stores/workspace-metadata-store";
import type { OpenTargetId, OpenTargetOption } from "@/utils/open-targets";
import { formatPathForDisplay } from "@/utils/path-display";
import { isMacPlatform } from "@/utils/platform";

type SettingsSection = "shortcuts";
type CreateShortcutResult = { ok: boolean; message?: string };

function formatTokenCount(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	if (count >= 1_000) {
		return `${(count / 1_000).toFixed(1)}k`;
	}
	return String(count);
}

const MOBILE_TOUCH_TARGET = "min-w-[44px] min-h-[44px]";

function getWorkspacePathSegments(path: string): string[] {
	return path
		.replaceAll("\\", "/")
		.split("/")
		.filter((segment) => segment.length > 0);
}

function FirstShortcutIconPicker({
	value,
	onSelect,
}: {
	value: RuntimeShortcutPickerIconId;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getRuntimeShortcutPickerOption(value);
	const SelectedIconComponent = getRuntimeShortcutIconComponent(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<SelectedIconComponent size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function GitBranchStatusControl({
	branchLabel,
	changedFiles,
	additions,
	deletions,
	onToggleGitHistory,
	isGitHistoryOpen,
}: {
	branchLabel: string;
	changedFiles: number;
	additions: number;
	deletions: number;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
}): React.ReactElement {
	if (onToggleGitHistory) {
		return (
			<div className="flex items-center min-w-0 overflow-hidden">
				<Button
					variant={isGitHistoryOpen ? "primary" : "default"}
					size="sm"
					icon={<GitBranch size={12} />}
					onClick={onToggleGitHistory}
					className={cn(
						"font-mono text-xs shrink min-w-0 max-w-full overflow-hidden",
						isGitHistoryOpen ? "ring-1 ring-accent" : "kb-navbar-btn",
					)}
					title={branchLabel}
				>
					<span className="truncate w-full text-left">{branchLabel}</span>
				</Button>
				<span className="font-mono text-xs text-text-tertiary ml-1.5 shrink-0 whitespace-nowrap">
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
					<span className="text-status-green"> +{additions}</span>
					<span className="text-status-red"> -{deletions}</span>)
				</span>
			</div>
		);
	}

	return (
		<span className="font-mono text-xs text-text-secondary mr-1 whitespace-nowrap">
			<GitBranch size={12} className="inline-block mr-1" style={{ verticalAlign: -1 }} />
			<span className="text-text-primary">{branchLabel}</span>
			<span className="ml-1.5">
				<span className="text-text-tertiary">
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
				</span>
				<span className="text-status-green"> +{additions}</span>
				<span className="text-status-red"> -{deletions}</span>
				<span className="text-text-tertiary">)</span>
			</span>
		</span>
	);
}

function TopBarGitStatusSection({
	showHomeGitSummary,
	selectedTaskId,
	selectedTaskBaseRef,
	onToggleGitHistory,
	isGitHistoryOpen,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
}: {
	showHomeGitSummary: boolean;
	selectedTaskId: string | null;
	selectedTaskBaseRef: string | null;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
}): React.ReactElement | null {
	const homeGitSummary = useHomeGitSummaryValue();
	const taskWorkspaceInfo = useTaskWorkspaceInfoValue(selectedTaskId, selectedTaskBaseRef);
	const taskWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(selectedTaskId);

	if (showHomeGitSummary && homeGitSummary) {
		const branchLabel = homeGitSummary.currentBranch ?? "detached HEAD";
		const pullCount = homeGitSummary.behindCount ?? 0;
		const pushCount = homeGitSummary.aheadCount ?? 0;
		const pullTooltip =
			pullCount > 0
				? `Pull ${pullCount} commit${pullCount === 1 ? "" : "s"} from upstream into your local branch.`
				: "Pull from upstream. Branch is already up to date.";
		const pushTooltip =
			pushCount > 0
				? `Push ${pushCount} local commit${pushCount === 1 ? "" : "s"} to upstream.`
				: "Push local commits to upstream. No local commits are pending.";
		return (
			<>
				<div className="w-px h-5 bg-border mx-1" />
				<GitBranchStatusControl
					branchLabel={branchLabel}
					changedFiles={homeGitSummary.changedFiles ?? 0}
					additions={homeGitSummary.additions ?? 0}
					deletions={homeGitSummary.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
				<div className="flex gap-0 ml-1">
					<Tooltip
						side="bottom"
						content="Fetch latest refs from upstream without changing your local branch or files."
					>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "fetch" ? <Spinner size={14} /> : <CircleArrowDown size={18} />}
							onClick={onGitFetch}
							disabled={runningGitAction === "fetch"}
							aria-label="Fetch from upstream"
						/>
					</Tooltip>
					<Tooltip side="bottom" content={pullTooltip}>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "pull" ? <Spinner size={14} /> : <ArrowDown size={14} />}
							onClick={onGitPull}
							disabled={runningGitAction === "pull"}
							aria-label="Pull from upstream"
						>
							<span className="text-text-tertiary">{pullCount}</span>
						</Button>
					</Tooltip>
					<Tooltip side="bottom" content={pushTooltip}>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "push" ? <Spinner size={14} /> : <ArrowUp size={14} />}
							onClick={onGitPush}
							disabled={runningGitAction === "push"}
							aria-label="Push to upstream"
						>
							<span className="text-text-tertiary">{pushCount}</span>
						</Button>
					</Tooltip>
				</div>
			</>
		);
	}

	if (selectedTaskId && (taskWorkspaceInfo || taskWorkspaceSnapshot)) {
		return (
			<>
				<div className="w-px h-5 bg-border mx-1" />
				<GitBranchStatusControl
					branchLabel={
						taskWorkspaceInfo?.branch ?? taskWorkspaceSnapshot?.headCommit?.slice(0, 8) ?? "initializing"
					}
					changedFiles={taskWorkspaceSnapshot?.changedFiles ?? 0}
					additions={taskWorkspaceSnapshot?.additions ?? 0}
					deletions={taskWorkspaceSnapshot?.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
			</>
		);
	}

	return null;
}

const PENDING_VALIDATION_RESULT_LABEL: Record<"pass" | "fail" | "needs_review", string> = {
	pass: "Pass",
	fail: "Fail",
	needs_review: "Needs Review",
};

const PENDING_VALIDATION_RESULT_CLASSNAME: Record<"pass" | "fail" | "needs_review", string> = {
	pass: "bg-status-green/15 text-status-green",
	fail: "bg-status-red/15 text-status-red",
	needs_review: "bg-status-orange/15 text-status-orange",
};

function formatRelativeTimestamp(value: string): string {
	const ts = Date.parse(value);
	if (Number.isNaN(ts)) return value;
	const diff = Date.now() - ts;
	if (diff < 0) return new Date(ts).toLocaleString();
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
}

function PendingValidationsChip({
	count,
	items,
	onSelect,
}: {
	count: number;
	items: Array<{
		taskId: string;
		title: string;
		reportResult: "pass" | "fail" | "needs_review";
		validatedAt: string;
	}>;
	onSelect?: (taskId: string) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const tooltipText = `${count} validation${count === 1 ? "" : "s"} awaiting PM review`;
	const sortedItems = [...items].sort((a, b) => Date.parse(b.validatedAt) - Date.parse(a.validatedAt));

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<Tooltip content={tooltipText} side="bottom">
				<RadixPopover.Trigger asChild>
					<button
						type="button"
						className="mr-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-status-orange/15 px-2 text-[11px] font-medium text-status-orange hover:bg-status-orange/25"
					>
						<HelpCircle size={12} />
						{count}
					</button>
				</RadixPopover.Trigger>
			</Tooltip>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="end"
					sideOffset={6}
					className="z-50 w-80 max-w-[90vw] rounded-md border border-border bg-surface-1 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
						Pending review
					</div>
					{sortedItems.length === 0 ? (
						<div className="px-2 py-2 text-xs text-text-tertiary">No details available.</div>
					) : (
						<ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
							{sortedItems.map((item) => (
								<li key={item.taskId}>
									<button
										type="button"
										onClick={() => {
											if (onSelect) onSelect(item.taskId);
											setOpen(false);
										}}
										className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-3"
									>
										<span
											className={cn(
												"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
												PENDING_VALIDATION_RESULT_CLASSNAME[item.reportResult],
											)}
										>
											{PENDING_VALIDATION_RESULT_LABEL[item.reportResult]}
										</span>
										<div className="min-w-0 flex-1">
											<div className="truncate text-xs font-medium text-text-primary">{item.title}</div>
											<div className="text-[10px] text-text-tertiary">
												{formatRelativeTimestamp(item.validatedAt)}
											</div>
										</div>
									</button>
								</li>
							))}
						</ul>
					)}
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

export function TopBar({
	onToggleSidebar,
	onBack,
	workspacePath,
	isWorkspacePathLoading = false,
	workspaceHint,
	runtimeHint,
	selectedTaskId,
	selectedTaskBaseRef,
	showHomeGitSummary,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
	onToggleTerminal,
	isTerminalOpen,
	isTerminalLoading,
	onToggleGitHistory,
	isGitHistoryOpen,
	onOpenSettings,
	showDebugButton,
	onOpenDebugDialog,
	shortcuts,
	selectedShortcutLabel,
	onSelectShortcutLabel,
	runningShortcutLabel,
	onRunShortcut,
	onCreateFirstShortcut,
	onOpenRoadmap,
	openTargetOptions,
	selectedOpenTargetId,
	onSelectOpenTarget,
	onOpenWorkspace,
	canOpenWorkspace,
	isOpeningWorkspace,
	hideProjectDependentActions = false,
	tokenUsage,
	pendingValidationCount = 0,
	pendingValidations,
	onSelectPendingValidation,
}: {
	onToggleSidebar?: () => void;
	onBack?: () => void;
	workspacePath?: string;
	isWorkspacePathLoading?: boolean;
	workspaceHint?: string;
	runtimeHint?: string;
	selectedTaskId?: string | null;
	selectedTaskBaseRef?: string | null;
	showHomeGitSummary?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
	onToggleTerminal?: () => void;
	isTerminalOpen?: boolean;
	isTerminalLoading?: boolean;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	onOpenSettings?: (section?: SettingsSection) => void;
	showDebugButton?: boolean;
	onOpenDebugDialog?: () => void;
	shortcuts?: RuntimeProjectShortcut[];
	selectedShortcutLabel?: string | null;
	onSelectShortcutLabel?: (shortcutLabel: string) => void;
	runningShortcutLabel?: string | null;
	onRunShortcut?: (shortcutLabel: string) => void;
	onCreateFirstShortcut?: (shortcut: RuntimeProjectShortcut) => Promise<CreateShortcutResult>;
	onOpenRoadmap?: () => void;
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
	hideProjectDependentActions?: boolean;
	tokenUsage?: RuntimeTokenUsage | null;
	/** Number of un-reviewed validations across the workspace; renders a chip when > 0. */
	pendingValidationCount?: number;
	/** Detail rows for the pending-validations popover; ordered by validatedAt desc. */
	pendingValidations?: Array<{
		taskId: string;
		title: string;
		reportResult: "pass" | "fail" | "needs_review";
		validatedAt: string;
	}>;
	/** Open the card detail view for the given task. */
	onSelectPendingValidation?: (taskId: string) => void;
}): React.ReactElement {
	const isMobile = useIsMobile();
	const displayWorkspacePath = workspacePath ? formatPathForDisplay(workspacePath) : null;
	const workspaceSegments = displayWorkspacePath ? getWorkspacePathSegments(displayWorkspacePath) : [];
	const hasAbsoluteLeadingSlash = Boolean(displayWorkspacePath?.startsWith("/"));
	const handleAddShortcut = () => {
		onOpenSettings?.("shortcuts");
	};
	const shortcutItems = shortcuts ?? [];
	const selectedShortcutIndex =
		selectedShortcutLabel === null || selectedShortcutLabel === undefined
			? 0
			: shortcutItems.findIndex((shortcut) => shortcut.label === selectedShortcutLabel);
	const selectedShortcut = shortcutItems[selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0] ?? null;
	const SelectedShortcutIcon = selectedShortcut ? getRuntimeShortcutIconComponent(selectedShortcut.icon) : Terminal;
	const [isCreateShortcutDialogOpen, setIsCreateShortcutDialogOpen] = useState(false);
	const [isCreateShortcutSaving, setIsCreateShortcutSaving] = useState(false);
	const [createShortcutError, setCreateShortcutError] = useState<string | null>(null);
	const [newShortcutIcon, setNewShortcutIcon] = useState<RuntimeShortcutPickerIconId>("play");
	const [newShortcutLabel, setNewShortcutLabel] = useState("Run");
	const [newShortcutCommand, setNewShortcutCommand] = useState("");
	const canSaveNewShortcut = newShortcutCommand.trim().length > 0;
	const handleOpenCreateShortcutDialog = () => {
		setCreateShortcutError(null);
		setNewShortcutIcon("play");
		setNewShortcutLabel("Run");
		setNewShortcutCommand("");
		setIsCreateShortcutDialogOpen(true);
	};
	const handleSaveFirstShortcut = async () => {
		if (!onCreateFirstShortcut || !canSaveNewShortcut || isCreateShortcutSaving) {
			return;
		}
		setCreateShortcutError(null);
		setIsCreateShortcutSaving(true);
		const result = await onCreateFirstShortcut({
			label: newShortcutLabel.trim(),
			command: newShortcutCommand.trim(),
			icon: newShortcutIcon,
		});
		setIsCreateShortcutSaving(false);
		if (!result.ok) {
			setCreateShortcutError(result.message ?? "Could not save shortcut.");
			return;
		}
		setIsCreateShortcutDialogOpen(false);
	};

	return (
		<>
			<nav
				className="kb-top-bar flex flex-nowrap items-center h-10 min-h-[40px] min-w-0 bg-surface-1"
				style={{
					paddingLeft: onBack ? 6 : 12,
					paddingRight: 8,
					borderBottom: "1px solid var(--color-divider)",
				}}
			>
				{/* ---- Left side: hamburger/back, path, hints, git ---- */}
				<div className="flex flex-nowrap items-center h-10 flex-1 min-w-0 overflow-hidden gap-1.5">
					{isMobile && onToggleSidebar ? (
						<Button
							variant="ghost"
							size="sm"
							icon={<Menu size={16} />}
							onClick={onToggleSidebar}
							aria-label="Toggle sidebar"
							className={cn("shrink-0", MOBILE_TOUCH_TARGET)}
						/>
					) : null}
					{onBack ? (
						<div className="flex items-center shrink-0 overflow-visible">
							<Button
								variant="ghost"
								size="sm"
								icon={<ArrowLeft size={16} />}
								onClick={onBack}
								aria-label="Back to board"
								className={cn("mr-1 shrink-0", isMobile && MOBILE_TOUCH_TARGET)}
							/>
						</div>
					) : null}

					{/* Workspace path */}
					{isWorkspacePathLoading ? (
						<span
							className="kb-skeleton inline-block"
							style={{ height: 14, width: isMobile ? 120 : 320, borderRadius: 3 }}
							aria-hidden
						/>
					) : displayWorkspacePath ? (
						<div className={cn("shrink min-w-0 overflow-hidden", isMobile ? "max-w-[180px]" : "max-w-[640px]")}>
							<span
								className="font-mono truncate block w-full min-w-0 text-xs max-w-full text-text-secondary"
								title={workspacePath}
								data-testid="workspace-path"
							>
								{isMobile ? (
									<span className="text-text-primary">{workspaceSegments[workspaceSegments.length - 1]}</span>
								) : (
									<>
										{hasAbsoluteLeadingSlash ? "/" : ""}
										{workspaceSegments.map((segment, index) => {
											const isLast = index === workspaceSegments.length - 1;
											return (
												<span key={`${segment}-${index}`}>
													{index === 0 ? "" : "/"}
													<span className={isLast ? "text-text-primary" : undefined}>{segment}</span>
												</span>
											);
										})}
									</>
								)}
							</span>
						</div>
					) : null}

					{/* Desktop-only: open-workspace button, hints, git status */}
					{!isMobile ? (
						<>
							{displayWorkspacePath && !isWorkspacePathLoading ? (
								<div className="ml-2 shrink-0">
									<OpenWorkspaceButton
										options={openTargetOptions}
										selectedOptionId={selectedOpenTargetId}
										disabled={!canOpenWorkspace || isOpeningWorkspace}
										loading={isOpeningWorkspace}
										onOpen={onOpenWorkspace}
										onSelectOption={onSelectOpenTarget}
									/>
								</div>
							) : null}
							{!hideProjectDependentActions && workspaceHint ? (
								<span className="kb-navbar-tag inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text-secondary">
									{workspaceHint}
								</span>
							) : null}
							{!hideProjectDependentActions && runtimeHint ? (
								onOpenSettings ? (
									<button
										type="button"
										onClick={() => onOpenSettings()}
										className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange transition-colors hover:bg-status-orange/15 focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-0"
									>
										{runtimeHint}
									</button>
								) : (
									<span className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange">
										{runtimeHint}
									</span>
								)
							) : null}
							{!hideProjectDependentActions ? (
								<TopBarGitStatusSection
									showHomeGitSummary={showHomeGitSummary === true}
									selectedTaskId={selectedTaskId ?? null}
									selectedTaskBaseRef={selectedTaskBaseRef ?? null}
									onToggleGitHistory={onToggleGitHistory}
									isGitHistoryOpen={isGitHistoryOpen}
									runningGitAction={runningGitAction}
									onGitFetch={onGitFetch}
									onGitPull={onGitPull}
									onGitPush={onGitPush}
								/>
							) : null}
							<>
								<div className="w-px h-5 bg-border mx-1" />
								<Tooltip
									side="bottom"
									content={`Input: ${(tokenUsage?.totalInputTokens ?? 0).toLocaleString()} tokens | Output: ${(tokenUsage?.totalOutputTokens ?? 0).toLocaleString()} tokens${tokenUsage?.totalCost !== undefined ? ` | Cost: $${tokenUsage.totalCost.toFixed(4)}` : ""}`}
								>
									<div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
										<span>
											{"↓"}
											{formatTokenCount(tokenUsage?.totalInputTokens ?? 0)}
										</span>
										<span>
											{"↑"}
											{formatTokenCount(tokenUsage?.totalOutputTokens ?? 0)}
										</span>
									</div>
								</Tooltip>
							</>
						</>
					) : null}
				</div>

				{/* ---- Right side: actions ---- */}
				<div className="flex flex-nowrap items-center h-10 pr-0.5 shrink-0">
					{/* Desktop: inline shortcut, terminal, debug buttons */}
					{!isMobile ? (
						<>
							{!hideProjectDependentActions && pendingValidationCount > 0 ? (
								<PendingValidationsChip
									count={pendingValidationCount}
									items={pendingValidations ?? []}
									onSelect={onSelectPendingValidation}
								/>
							) : null}
							{onOpenRoadmap && !hideProjectDependentActions ? (
								<Button
									variant="default"
									size="sm"
									icon={<MapIcon size={14} />}
									onClick={onOpenRoadmap}
									className="text-xs kb-navbar-btn mr-1"
								>
									Roadmap
								</Button>
							) : null}
							{!hideProjectDependentActions && onRunShortcut ? (
								selectedShortcut ? (
									<div className="flex">
										<Button
											variant="default"
											size="sm"
											icon={
												runningShortcutLabel ? <Spinner size={12} /> : <SelectedShortcutIcon size={14} />
											}
											disabled={Boolean(runningShortcutLabel)}
											onClick={() => onRunShortcut(selectedShortcut.label)}
											className="text-xs rounded-r-none kb-navbar-btn"
										>
											{selectedShortcut.label}
										</Button>
										<RadixPopover.Root>
											<RadixPopover.Trigger asChild>
												<Button
													size="sm"
													variant="default"
													icon={<ChevronDown size={12} />}
													aria-label="Select shortcut"
													disabled={Boolean(runningShortcutLabel)}
													className="rounded-l-none border-l-0 kb-navbar-btn"
													style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}
												/>
											</RadixPopover.Trigger>
											<RadixPopover.Portal>
												<RadixPopover.Content
													className="z-50 rounded-lg border border-border bg-surface-2 p-1 shadow-xl"
													style={{ animation: "kb-tooltip-show 100ms ease" }}
													sideOffset={5}
													align="end"
												>
													<div className="min-w-[180px]">
														{shortcutItems.map((shortcut, shortcutIndex) => {
															const ShortcutIcon = getRuntimeShortcutIconComponent(shortcut.icon);
															const isActive =
																shortcutIndex ===
																(selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0);
															return (
																<button
																	type="button"
																	key={`${shortcut.label}:${shortcut.command}:${shortcutIndex}`}
																	className={cn(
																		"flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left",
																		isActive && "bg-surface-3",
																	)}
																	onClick={() => onSelectShortcutLabel?.(shortcut.label)}
																>
																	<ShortcutIcon size={14} />
																	<span className="flex-1">{shortcut.label}</span>
																	{isActive ? (
																		<Check size={14} className="text-text-secondary" />
																	) : null}
																</button>
															);
														})}
														<div className="h-px bg-border my-1" />
														<button
															type="button"
															className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left"
															onClick={handleAddShortcut}
														>
															<Plus size={14} />
															<span>Add shortcut</span>
														</button>
													</div>
												</RadixPopover.Content>
											</RadixPopover.Portal>
										</RadixPopover.Root>
									</div>
								) : onCreateFirstShortcut ? (
									<Button
										variant="default"
										size="sm"
										icon={<Play size={14} />}
										onClick={handleOpenCreateShortcutDialog}
										className="text-xs kb-navbar-btn"
									>
										Run
									</Button>
								) : null
							) : null}
							{onToggleTerminal ? (
								<Tooltip
									side="bottom"
									content={
										<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
											<span>Toggle terminal</span>
											<span className="inline-flex items-center gap-0.5 whitespace-nowrap">
												<span>(</span>
												{isMacPlatform ? <Command size={11} /> : <span>Ctrl</span>}
												<span>+ J)</span>
											</span>
										</span>
									}
								>
									<Button
										variant="ghost"
										size="sm"
										icon={<Terminal size={16} />}
										onClick={onToggleTerminal}
										disabled={Boolean(isTerminalLoading)}
										aria-label={isTerminalOpen ? "Close terminal" : "Open terminal"}
										className="ml-2"
									/>
								</Tooltip>
							) : null}
							{showDebugButton && onOpenDebugDialog ? (
								<Button
									variant="ghost"
									size="sm"
									icon={<Bug size={16} />}
									onClick={onOpenDebugDialog}
									aria-label="Debug"
									data-testid="open-debug-dialog-button"
									className="ml-0.5 mr-0.5"
								/>
							) : null}
						</>
					) : null}

					{/* Mobile: inline run + terminal buttons (icon-only) */}
					{isMobile ? (
						<>
							{!hideProjectDependentActions && onRunShortcut && selectedShortcut ? (
								<Button
									variant="ghost"
									size="sm"
									icon={runningShortcutLabel ? <Spinner size={14} /> : <SelectedShortcutIcon size={14} />}
									disabled={Boolean(runningShortcutLabel)}
									onClick={() => onRunShortcut(selectedShortcut.label)}
									aria-label={selectedShortcut.label}
									className={MOBILE_TOUCH_TARGET}
								/>
							) : null}
							{onToggleTerminal ? (
								<Button
									variant="ghost"
									size="sm"
									icon={<Terminal size={16} />}
									onClick={onToggleTerminal}
									disabled={Boolean(isTerminalLoading)}
									aria-label={isTerminalOpen ? "Close terminal" : "Open terminal"}
									className={MOBILE_TOUCH_TARGET}
								/>
							) : null}
						</>
					) : null}

					{/* Settings: always visible */}
					<Button
						variant="ghost"
						size="sm"
						icon={<Settings size={16} />}
						onClick={() => onOpenSettings?.()}
						aria-label="Settings"
						data-testid="open-settings-button"
						className={cn("ml-0.5 mr-0.5", isMobile && MOBILE_TOUCH_TARGET)}
					/>
				</div>
			</nav>
			<Dialog
				open={isCreateShortcutDialogOpen}
				contentAriaDescribedBy={undefined}
				onOpenChange={(nextOpen) => {
					if (isCreateShortcutSaving) {
						return;
					}
					setIsCreateShortcutDialogOpen(nextOpen);
					if (!nextOpen) {
						setCreateShortcutError(null);
					}
				}}
			>
				<DialogHeader title="Set up your first script shortcut" icon={<Play size={16} />} />
				<DialogBody>
					<p className="text-text-secondary text-[13px] mt-0 mb-2">
						Script shortcuts run a command in the bottom terminal so you can quickly run and test your project.
					</p>
					<p className="text-text-secondary text-[13px] mt-0 mb-3">
						You can always open Settings to add and manage more shortcuts later.
					</p>
					<div className="grid gap-2" style={{ gridTemplateColumns: "max-content 1fr 2fr" }}>
						<FirstShortcutIconPicker value={newShortcutIcon} onSelect={setNewShortcutIcon} />
						<input
							value={newShortcutLabel}
							onChange={(event) => setNewShortcutLabel(event.target.value)}
							placeholder="Label"
							disabled={isCreateShortcutSaving}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-60"
						/>
						<input
							value={newShortcutCommand}
							onChange={(event) => setNewShortcutCommand(event.target.value)}
							placeholder="npm run dev"
							disabled={isCreateShortcutSaving}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-60"
						/>
					</div>
					{createShortcutError ? (
						<p className="text-status-red text-[13px] mt-3 mb-0">{createShortcutError}</p>
					) : null}
				</DialogBody>
				<DialogFooter>
					<Button
						onClick={() => {
							if (!isCreateShortcutSaving) {
								setIsCreateShortcutDialogOpen(false);
								setCreateShortcutError(null);
							}
						}}
						disabled={isCreateShortcutSaving}
					>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							void handleSaveFirstShortcut();
						}}
						disabled={!canSaveNewShortcut || isCreateShortcutSaving}
					>
						{isCreateShortcutSaving ? (
							<>
								<Spinner size={12} />
								Saving...
							</>
						) : (
							"Save"
						)}
					</Button>
				</DialogFooter>
			</Dialog>
		</>
	);
}
