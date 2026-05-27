import * as Collapsible from "@radix-ui/react-collapsible";
import type { RuntimeAppRouter } from "@runtime-trpc";
import type { inferRouterOutputs } from "@trpc/server";
import {
	AlertTriangle,
	Briefcase,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Code,
	Copy,
	Download,
	Eye,
	FileText,
	FlaskConical,
	HelpCircle,
	Play,
	RotateCcw,
	Search,
	Shield,
	Terminal,
	ThumbsDown,
	ThumbsUp,
	X,
	XCircle,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { SubKpiSection } from "./sub-kpi-section";

// ---------------------------------------------------------------------------
// Types derived from the tRPC router
// ---------------------------------------------------------------------------

type RouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
type DeliverableResponse = RouterOutputs["runtime"]["readDeliverable"];
type ValidationReportResponse = RouterOutputs["runtime"]["readValidationReport"];
type ExperimentLogsResponse = RouterOutputs["runtime"]["readExperimentLogs"];
type ReviewFeedbackResponse = RouterOutputs["runtime"]["readReviewFeedback"];
type ValidationHistoryResponse = RouterOutputs["runtime"]["getTaskValidationHistory"];

interface DeliverableJobView {
	title: string;
	status: "done" | "partial" | "skipped" | "failed";
	detail?: string;
}

interface DeliverableWorkSummaryView {
	jobs: DeliverableJobView[];
	commands: string[];
	durationMs?: number;
	notes?: string;
}

interface DeliverableParsed {
	taskId: string;
	summary: string;
	roadmapItemId?: string;
	roadmapVersion?: number;
	agent?: string;
	completedAt?: string;
	workSummary?: DeliverableWorkSummaryView;
	requirementsCheck: Array<{
		requirement: string;
		status: "met" | "partial" | "skipped";
		evidence?: string;
	}>;
	changedFiles: string[];
	openQuestions: string[];
}

interface ValidationWorkStepView {
	title: string;
	status: "done" | "partial" | "skipped";
	detail?: string;
}

interface ValidationWorkSummaryView {
	steps: ValidationWorkStepView[];
	evidence: string[];
	durationMs?: number;
	notes?: string;
}

interface ValidationReport {
	taskId: string;
	specSlug: string;
	roadmapItemId: string;
	result: "pass" | "fail" | "needs_review";
	validatedAt: string;
	checks: Array<{
		check: string;
		status: "pass" | "fail" | "needs_review";
		details: string;
	}>;
	summary: string;
	workSummary?: ValidationWorkSummaryView;
}

type ExperimentLog = ExperimentLogsResponse[number];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeliverableValidationPanelProps {
	taskId: string;
	workspaceId: string | null;
	/** Required to trigger a manual validation run; omitted for read-only views. */
	roadmapItemId?: string;
	specSlug?: string;
	ownedPaths?: string[];
	/**
	 * Monotonically-increasing token. Bumping it forces the panel to refetch.
	 * Wire this to a runtime-state event (e.g. task-ready-for-review) so the
	 * panel updates live as the agent writes files.
	 */
	refreshToken?: number;
	/** Click handler for changed-files entries; jumps the diff viewer to the path. */
	onSelectFile?: (path: string) => void;
	/** Paths currently visible in the diff viewer. Used to enable/disable file links. */
	availableFilePaths?: string[];
}

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

interface DeliverableValidationData {
	deliverable: DeliverableResponse | null;
	validationReport: ValidationReportResponse | null;
	experimentLogs: ExperimentLogsResponse;
	reviewFeedback: ReviewFeedbackResponse | null;
	validationHistory: ValidationHistoryResponse;
	isLoading: boolean;
	loadError: string | null;
	refetch: () => void;
}

function useDeliverableValidation(
	taskId: string,
	workspaceId: string | null,
	refreshToken: number | undefined,
): DeliverableValidationData {
	const [deliverable, setDeliverable] = useState<DeliverableResponse | null>(null);
	const [validationReport, setValidationReport] = useState<ValidationReportResponse | null>(null);
	const [experimentLogs, setExperimentLogs] = useState<ExperimentLogsResponse>([]);
	const [reviewFeedback, setReviewFeedback] = useState<ReviewFeedbackResponse | null>(null);
	const [validationHistory, setValidationHistory] = useState<ValidationHistoryResponse>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const fetchData = useCallback(() => {
		// Cancel any in-flight requests from the previous fetch so stale data
		// can't overwrite fresh state.
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const isLive = () => !controller.signal.aborted;

		if (!workspaceId) {
			setIsLoading(false);
			setLoadError(null);
			return;
		}

		setLoadError(null);
		const trpc = getRuntimeTrpcClient(workspaceId);
		const failures: string[] = [];

		const deliverablePromise = trpc.runtime.readDeliverable
			.query({ taskId }, { signal: controller.signal })
			.then((result) => {
				if (isLive()) setDeliverable(result);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setDeliverable(null);
				failures.push(`deliverable: ${errorMessage(error)}`);
			});

		const reportPromise = trpc.runtime.readValidationReport
			.query({ taskId }, { signal: controller.signal })
			.then((result) => {
				if (isLive()) setValidationReport(result);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setValidationReport(null);
				failures.push(`validation report: ${errorMessage(error)}`);
			});

		const experimentsPromise = trpc.runtime.readExperimentLogs
			.query({ taskId }, { signal: controller.signal })
			.then((result) => {
				if (isLive()) setExperimentLogs(result);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setExperimentLogs([]);
				failures.push(`experiment logs: ${errorMessage(error)}`);
			});

		const feedbackPromise = trpc.runtime.readReviewFeedback
			.query({ taskId }, { signal: controller.signal })
			.then((result) => {
				if (isLive()) setReviewFeedback(result);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setReviewFeedback(null);
				failures.push(`review feedback: ${errorMessage(error)}`);
			});

		const historyPromise = trpc.runtime.getTaskValidationHistory
			.query({ taskId }, { signal: controller.signal })
			.then((result) => {
				if (isLive()) setValidationHistory(result);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setValidationHistory([]);
				failures.push(`validation history: ${errorMessage(error)}`);
			});

		void Promise.all([deliverablePromise, reportPromise, experimentsPromise, feedbackPromise, historyPromise]).then(
			() => {
				if (controller.signal.aborted) return;
				setIsLoading(false);
				setLoadError(failures.length > 0 ? `Failed to load: ${failures.join("; ")}` : null);
			},
		);
	}, [taskId, workspaceId]);

	useEffect(() => {
		setIsLoading(true);
		setDeliverable(null);
		setValidationReport(null);
		setExperimentLogs([]);
		setReviewFeedback(null);
		setValidationHistory([]);
		setLoadError(null);
		fetchData();
		return () => {
			abortRef.current?.abort();
		};
	}, [fetchData]);

	// Refetch in place (no spinner flicker) when the parent bumps refreshToken.
	useEffect(() => {
		if (refreshToken == null) return;
		fetchData();
	}, [refreshToken, fetchData]);

	return {
		deliverable,
		validationReport,
		experimentLogs,
		reviewFeedback,
		validationHistory,
		isLoading,
		loadError,
		refetch: fetchData,
	};
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RequirementStatusIcon({ status }: { status: "met" | "partial" | "skipped" }): ReactElement {
	switch (status) {
		case "met":
			return <Check size={14} className="shrink-0 text-status-green" />;
		case "partial":
			return <AlertTriangle size={14} className="shrink-0 text-status-orange" />;
		case "skipped":
			return <X size={14} className="shrink-0 text-status-red" />;
	}
}

function JobStatusIcon({ status }: { status: DeliverableJobView["status"] }): ReactElement {
	switch (status) {
		case "done":
			return <Check size={14} className="shrink-0 text-status-green" />;
		case "partial":
			return <AlertTriangle size={14} className="shrink-0 text-status-orange" />;
		case "failed":
			return <XCircle size={14} className="shrink-0 text-status-red" />;
		case "skipped":
			return <X size={14} className="shrink-0 text-text-tertiary" />;
	}
}

function ValidationStepIcon({ status }: { status: ValidationWorkStepView["status"] }): ReactElement {
	switch (status) {
		case "done":
			return <Check size={14} className="shrink-0 text-status-green" />;
		case "partial":
			return <AlertTriangle size={14} className="shrink-0 text-status-orange" />;
		case "skipped":
			return <X size={14} className="shrink-0 text-text-tertiary" />;
	}
}

function ValidationCheckStatusIcon({ status }: { status: "pass" | "fail" | "needs_review" }): ReactElement {
	switch (status) {
		case "pass":
			return <CheckCircle2 size={13} className="shrink-0 text-status-green" />;
		case "fail":
			return <XCircle size={13} className="shrink-0 text-status-red" />;
		case "needs_review":
			return <HelpCircle size={13} className="shrink-0 text-status-orange" />;
	}
}

function ResultBadge({ result }: { result: "pass" | "fail" | "needs_review" }): ReactElement {
	const config = {
		pass: { label: "Pass", className: "bg-status-green/15 text-status-green" },
		fail: { label: "Fail", className: "bg-status-red/15 text-status-red" },
		needs_review: { label: "Needs Review", className: "bg-status-orange/15 text-status-orange" },
	} as const;
	const { label, className } = config[result];
	return (
		<span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", className)}>
			{result === "pass" ? (
				<CheckCircle2 size={12} />
			) : result === "fail" ? (
				<XCircle size={12} />
			) : (
				<AlertTriangle size={12} />
			)}
			{label}
		</span>
	);
}

function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
	return (
		<div className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-xs text-status-red">
			<XCircle size={14} className="mt-0.5 shrink-0" />
			<div className="min-w-0 flex-1">
				<div className="font-medium">Couldn't load some panel data.</div>
				<div className="mt-0.5 truncate text-text-tertiary" title={message}>
					{message}
				</div>
			</div>
			<button
				type="button"
				onClick={onRetry}
				className="shrink-0 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-status-red hover:bg-status-red/15"
			>
				<RotateCcw size={11} />
				Retry
			</button>
		</div>
	);
}

function StalenessWarning(): ReactElement {
	return (
		<div className="flex items-start gap-2 rounded-md border border-status-orange/30 bg-status-orange/10 px-3 py-2 text-xs text-status-orange">
			<AlertTriangle size={14} className="mt-0.5 shrink-0" />
			<span>The spec was updated after this deliverable was written. The requirements check may be outdated.</span>
		</div>
	);
}

function RawMarkdownToggle({
	showRaw,
	onToggle,
	className,
}: {
	showRaw: boolean;
	onToggle: () => void;
	className?: string;
}): ReactElement {
	return (
		<button
			type="button"
			onClick={onToggle}
			className={cn(
				"inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-tertiary hover:bg-surface-3 hover:text-text-secondary",
				className,
			)}
			aria-pressed={showRaw}
		>
			{showRaw ? <Eye size={11} /> : <Code size={11} />}
			{showRaw ? "Parsed" : "Raw"}
		</button>
	);
}

function RawMarkdownView({ content }: { content: string }): ReactElement {
	return (
		<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-0 px-2 py-1.5 font-mono text-[11px] leading-snug text-text-secondary">
			{content}
		</pre>
	);
}

function EmptyDeliverableState({
	canRunValidation,
	onRunValidation,
	isValidating,
}: {
	canRunValidation: boolean;
	onRunValidation: () => void;
	isValidating: boolean;
}): ReactElement {
	return (
		<div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-surface-1 px-3 py-3 text-xs text-text-tertiary">
			<div className="flex items-center gap-2 font-semibold uppercase tracking-wide text-text-secondary">
				<FileText size={13} />
				Awaiting deliverable
			</div>
			<p className="leading-relaxed">
				When the task agent finishes, it will write{" "}
				<code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-text-secondary">
					.kanban/tasks/&lt;taskId&gt;/deliverable.md
				</code>{" "}
				with a summary, work narrative, and requirements check. Experiment logs go in{" "}
				<code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-text-secondary">
					experiments/
				</code>
				. Once the deliverable exists you can run the validator from here.
			</p>
			{canRunValidation ? (
				<div>
					<Button
						variant="default"
						size="sm"
						icon={isValidating ? <Spinner size={12} /> : <Play size={14} />}
						disabled={!canRunValidation}
						onClick={onRunValidation}
					>
						Run validation anyway
					</Button>
				</div>
			) : null}
		</div>
	);
}

function WorkSummarySection({
	work,
	agent,
	durationFallback,
}: {
	work: DeliverableWorkSummaryView;
	agent?: string;
	durationFallback?: number;
}): ReactElement {
	const duration = work.durationMs ?? durationFallback;
	const hasJobs = work.jobs.length > 0;
	const hasCommands = work.commands.length > 0;
	if (!hasJobs && !hasCommands && !work.notes) return <></>;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<Briefcase size={13} />
				Execution Agent Work
				{agent ? (
					<span className="ml-1 inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-tertiary">
						{agent}
					</span>
				) : null}
				{duration != null ? (
					<span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-text-tertiary">
						{formatDuration(duration)}
					</span>
				) : null}
			</div>

			{hasJobs ? (
				<div className="flex flex-col gap-1">
					<div className="text-xs font-medium text-text-secondary">Jobs ({work.jobs.length})</div>
					<div className="flex flex-col gap-1">
						{work.jobs.map((job, i) => (
							<div key={i} className="flex items-start gap-2 text-xs">
								<JobStatusIcon status={job.status} />
								<div className="min-w-0 flex-1">
									<span
										className={cn(
											job.status === "done" && "text-text-secondary",
											job.status === "partial" && "text-status-orange",
											job.status === "failed" && "text-status-red",
											job.status === "skipped" && "text-text-tertiary",
										)}
									>
										{job.title}
									</span>
									{job.detail ? <span className="ml-1 text-text-tertiary"> -- {job.detail}</span> : null}
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}

			{hasCommands ? (
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-1 text-xs font-medium text-text-secondary">
						<Terminal size={11} />
						Commands ({work.commands.length})
					</div>
					<div className="flex flex-col gap-0.5">
						{work.commands.map((cmd, i) => (
							<div
								key={i}
								className="truncate rounded-sm bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-secondary"
								title={cmd}
							>
								{cmd}
							</div>
						))}
					</div>
				</div>
			) : null}

			{work.notes ? <div className="text-xs leading-relaxed text-text-tertiary">{work.notes}</div> : null}
		</div>
	);
}

function DeliverableSection({
	parsed,
	rawMarkdown,
	onSelectFile,
	availableFilePaths,
}: {
	parsed: DeliverableParsed;
	rawMarkdown: string | null;
	onSelectFile?: (path: string) => void;
	availableFilePaths?: string[];
}): ReactElement {
	const completedRelative = formatRelativeTime(parsed.completedAt);
	const [showRaw, setShowRaw] = useState(false);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<FileText size={13} />
				Deliverable
				{completedRelative ? (
					<span
						className="ml-auto text-[10px] font-normal normal-case tracking-normal text-text-tertiary"
						title={parsed.completedAt}
					>
						{completedRelative}
					</span>
				) : null}
				{rawMarkdown ? (
					<RawMarkdownToggle
						showRaw={showRaw}
						onToggle={() => setShowRaw((v) => !v)}
						className={completedRelative ? "" : "ml-auto"}
					/>
				) : null}
			</div>

			{showRaw && rawMarkdown ? <RawMarkdownView content={rawMarkdown} /> : <></>}
			{!showRaw ? (
				<DeliverableParsedBody
					parsed={parsed}
					onSelectFile={onSelectFile}
					availableFilePaths={availableFilePaths}
				/>
			) : null}
		</div>
	);
}

function DeliverableParsedBody({
	parsed,
	onSelectFile,
	availableFilePaths,
}: {
	parsed: DeliverableParsed;
	onSelectFile?: (path: string) => void;
	availableFilePaths?: string[];
}): ReactElement {
	const availablePathSet = availableFilePaths ? new Set(availableFilePaths) : null;
	return (
		<>
			{/* Summary */}
			{parsed.summary ? <div className="text-xs leading-relaxed text-text-secondary">{parsed.summary}</div> : null}

			{/* Work summary (execution agent's job/work narrative) */}
			{parsed.workSummary ? <WorkSummarySection work={parsed.workSummary} agent={parsed.agent} /> : null}

			{/* Requirements check */}
			{parsed.requirementsCheck.length > 0 ? (
				<div className="flex flex-col gap-1">
					<div className="text-xs font-medium text-text-secondary">Requirements</div>
					<div className="flex flex-col gap-1">
						{parsed.requirementsCheck.map((req, i) => (
							<div key={i} className="flex items-start gap-2 text-xs">
								<RequirementStatusIcon status={req.status} />
								<div className="min-w-0 flex-1">
									<span
										className={cn(
											req.status === "met" && "text-text-secondary",
											req.status === "partial" && "text-status-orange",
											req.status === "skipped" && "text-status-red",
										)}
									>
										{req.requirement}
									</span>
									{req.evidence ? <span className="ml-1 text-text-tertiary"> -- {req.evidence}</span> : null}
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}

			{/* Changed files */}
			{parsed.changedFiles.length > 0 ? (
				<div className="flex flex-col gap-1">
					<div className="text-xs font-medium text-text-secondary">
						Changed files ({parsed.changedFiles.length})
					</div>
					<div className="flex flex-col gap-0.5">
						{parsed.changedFiles.map((file) => {
							const normalized = file.replace(/^\//, "");
							const isClickable =
								!!onSelectFile && (availablePathSet == null || availablePathSet.has(normalized));
							if (isClickable) {
								return (
									<button
										key={file}
										type="button"
										onClick={() => onSelectFile?.(normalized)}
										className="cursor-pointer truncate rounded-sm bg-transparent text-left font-mono text-xs text-text-tertiary hover:bg-surface-3 hover:text-accent"
										title={`Open ${file} in diff viewer`}
									>
										{file}
									</button>
								);
							}
							return (
								<div
									key={file}
									className="truncate text-xs font-mono text-text-tertiary"
									title={
										onSelectFile
											? `${file}\n(not in current diff — file may not be modified or path differs)`
											: file
									}
								>
									{file}
								</div>
							);
						})}
					</div>
				</div>
			) : null}

			{/* Open questions */}
			{parsed.openQuestions.length > 0 ? (
				<div className="flex flex-col gap-1">
					<div className="text-xs font-medium text-text-secondary">Open questions</div>
					<ul className="flex flex-col gap-0.5 pl-3">
						{parsed.openQuestions.map((q, i) => (
							<li key={i} className="list-disc text-xs text-text-tertiary">
								{q}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</>
	);
}

function ValidatorWorkSection({ work }: { work: ValidationWorkSummaryView }): ReactElement {
	if (work.steps.length === 0 && work.evidence.length === 0 && !work.notes) return <></>;
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-[11px] font-medium text-text-secondary">
				<Briefcase size={11} />
				Validator work
				{work.durationMs != null ? (
					<span className="ml-auto text-[10px] font-normal text-text-tertiary">
						{formatDuration(work.durationMs)}
					</span>
				) : null}
			</div>

			{work.steps.length > 0 ? (
				<div className="flex flex-col gap-1">
					{work.steps.map((step, i) => (
						<div key={i} className="flex items-start gap-2 text-xs">
							<ValidationStepIcon status={step.status} />
							<div className="min-w-0 flex-1">
								<span
									className={cn(
										step.status === "done" && "text-text-secondary",
										step.status === "partial" && "text-status-orange",
										step.status === "skipped" && "text-text-tertiary",
									)}
								>
									{step.title}
								</span>
								{step.detail ? <span className="ml-1 text-text-tertiary"> -- {step.detail}</span> : null}
							</div>
						</div>
					))}
				</div>
			) : null}

			{work.evidence.length > 0 ? (
				<div className="flex flex-col gap-0.5">
					<div className="text-[11px] font-medium text-text-secondary">Evidence</div>
					{work.evidence.map((e, i) => (
						<div key={i} className="truncate text-xs font-mono text-text-tertiary" title={e}>
							{e}
						</div>
					))}
				</div>
			) : null}

			{work.notes ? <div className="text-xs leading-relaxed text-text-tertiary">{work.notes}</div> : null}
		</div>
	);
}

function ValidationReportSection({
	report,
	rawMarkdown,
	onReview,
	reviewState,
}: {
	report: ValidationReport;
	rawMarkdown: string | null;
	onReview?: (outcome: "accepted" | "rejected" | "escalated") => void;
	reviewState: { pending: "accepted" | "rejected" | "escalated" | null };
}): ReactElement {
	const validatedRelative = formatRelativeTime(report.validatedAt);
	const canReview = onReview != null && report.result !== "pass";
	const [showRaw, setShowRaw] = useState(false);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<Shield size={13} />
				Validation
				<ResultBadge result={report.result} />
				{validatedRelative ? (
					<span
						className="ml-auto text-[10px] font-normal normal-case tracking-normal text-text-tertiary"
						title={report.validatedAt}
					>
						{validatedRelative}
					</span>
				) : null}
				{rawMarkdown ? (
					<RawMarkdownToggle
						showRaw={showRaw}
						onToggle={() => setShowRaw((v) => !v)}
						className={validatedRelative ? "" : "ml-auto"}
					/>
				) : null}
			</div>

			{showRaw && rawMarkdown ? (
				<RawMarkdownView content={rawMarkdown} />
			) : (
				<>
					{/* Validator's own work narrative */}
					{report.workSummary ? <ValidatorWorkSection work={report.workSummary} /> : null}

					{/* Per-check results */}
					{report.checks.length > 0 ? (
						<div className="flex flex-col gap-1">
							{report.checks.map((check) => (
								<div key={check.check} className="flex items-start gap-2 text-xs">
									<ValidationCheckStatusIcon status={check.status} />
									<div className="min-w-0 flex-1">
										<span className="text-text-secondary">{formatCheckName(check.check)}</span>
										{check.status !== "pass" ? (
											<span className="ml-1 text-text-tertiary"> -- {check.details}</span>
										) : null}
									</div>
								</div>
							))}
						</div>
					) : null}

					{/* Summary */}
					{report.summary ? (
						<div className="text-xs text-text-tertiary leading-relaxed">{report.summary}</div>
					) : null}
				</>
			)}

			{/* Review actions — only meaningful when the report needs PM judgment */}
			{canReview ? (
				<div className="flex flex-col gap-1 pt-1">
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							icon={reviewState.pending === "accepted" ? <Spinner size={12} /> : <ThumbsUp size={14} />}
							disabled={reviewState.pending != null}
							onClick={() => onReview?.("accepted")}
							title="Accept (A)"
						>
							Accept
						</Button>
						<Button
							variant="danger"
							size="sm"
							icon={reviewState.pending === "rejected" ? <Spinner size={12} /> : <ThumbsDown size={14} />}
							disabled={reviewState.pending != null}
							onClick={() => onReview?.("rejected")}
							title="Reject (Shift+R)"
						>
							Reject
						</Button>
						<Button
							variant="ghost"
							size="sm"
							icon={reviewState.pending === "escalated" ? <Spinner size={12} /> : <AlertTriangle size={14} />}
							disabled={reviewState.pending != null}
							onClick={() => onReview?.("escalated")}
							title="Escalate (E)"
						>
							Escalate
						</Button>
					</div>
					<div className="text-[10px] text-text-tertiary">
						<kbd className="rounded-sm bg-surface-2 px-1 font-mono">A</kbd> accept{" "}
						<kbd className="rounded-sm bg-surface-2 px-1 font-mono">⇧R</kbd> reject{" "}
						<kbd className="rounded-sm bg-surface-2 px-1 font-mono">E</kbd> escalate
					</div>
				</div>
			) : null}
		</div>
	);
}

function ExperimentLogEntry({
	log,
	workspaceId,
	taskId,
}: {
	log: ExperimentLog;
	workspaceId: string | null;
	taskId: string;
}): ReactElement {
	const [open, setOpen] = useState(false);
	const [fullContent, setFullContent] = useState<string | null>(null);
	const [isLoadingFull, setIsLoadingFull] = useState(false);

	const displayContent = fullContent ?? log.content;
	const isShowingTruncated = log.truncated && fullContent == null;

	const handleCopy = useCallback(
		async (event: React.MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			try {
				await navigator.clipboard.writeText(displayContent);
				showAppToast({ intent: "success", message: `Copied "${log.name}" to clipboard.`, timeout: 2500 });
			} catch {
				showAppToast({ intent: "danger", icon: "warning-sign", message: "Copy failed.", timeout: 4000 });
			}
		},
		[displayContent, log.name],
	);

	const handleDownload = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			const blob = new Blob([displayContent], { type: "text/plain" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = log.name;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		},
		[displayContent, log.name],
	);

	const handleLoadFull = useCallback(
		async (event: React.MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			if (!workspaceId) return;
			setIsLoadingFull(true);
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				const result = await trpc.runtime.readExperimentLogFull.query({ taskId, name: log.name });
				if (result?.content != null) {
					setFullContent(result.content);
				} else {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not load full log.",
						timeout: 4000,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to load full log.";
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 4000 });
			} finally {
				setIsLoadingFull(false);
			}
		},
		[workspaceId, taskId, log.name],
	);

	return (
		<Collapsible.Root open={open} onOpenChange={setOpen}>
			<Collapsible.Trigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1 text-left text-xs text-text-secondary hover:bg-surface-3"
				>
					{open ? (
						<ChevronDown size={12} className="text-text-tertiary" />
					) : (
						<ChevronRight size={12} className="text-text-tertiary" />
					)}
					<span className="truncate font-mono">{log.name}</span>
					<span className="ml-auto shrink-0 text-[10px] text-text-tertiary">
						{formatBytes(log.bytes)}
						{isShowingTruncated ? " (truncated)" : ""}
					</span>
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<div className="mt-1 flex items-center gap-1 px-1">
					<button
						type="button"
						onClick={handleCopy}
						className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
						title="Copy contents"
					>
						<Copy size={11} />
						Copy
					</button>
					<button
						type="button"
						onClick={handleDownload}
						className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
						title="Download as file"
					>
						<Download size={11} />
						Download
					</button>
					{isShowingTruncated ? (
						<button
							type="button"
							onClick={handleLoadFull}
							disabled={isLoadingFull || workspaceId == null}
							className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-status-orange hover:bg-status-orange/15 disabled:opacity-40"
							title="Fetch the full log content"
						>
							{isLoadingFull ? <Spinner size={10} /> : <Download size={11} />}
							Load full
						</button>
					) : null}
				</div>
				<pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-0 px-2 py-1.5 font-mono text-[11px] leading-snug text-text-secondary">
					{displayContent}
				</pre>
			</Collapsible.Content>
		</Collapsible.Root>
	);
}

const EXPERIMENT_LOG_FILTER_THRESHOLD = 5;

function ExperimentLogsSection({
	logs,
	workspaceId,
	taskId,
}: {
	logs: ExperimentLog[];
	workspaceId: string | null;
	taskId: string;
}): ReactElement {
	const [filter, setFilter] = useState("");
	const showFilter = logs.length >= EXPERIMENT_LOG_FILTER_THRESHOLD;
	const visibleLogs = filter ? logs.filter((log) => log.name.toLowerCase().includes(filter.toLowerCase())) : logs;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<FlaskConical size={13} />
				Experiment Logs
				<span className="ml-1 inline-flex items-center rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-tertiary">
					{showFilter && filter ? `${visibleLogs.length}/${logs.length}` : logs.length}
				</span>
			</div>
			{showFilter ? (
				<div className="flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1">
					<Search size={11} className="text-text-tertiary" />
					<input
						type="text"
						value={filter}
						onChange={(event) => setFilter(event.currentTarget.value)}
						placeholder="Filter by name..."
						className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
					/>
					{filter ? (
						<button
							type="button"
							onClick={() => setFilter("")}
							className="text-text-tertiary hover:text-text-secondary"
							aria-label="Clear filter"
						>
							<X size={11} />
						</button>
					) : null}
				</div>
			) : null}
			<div className="flex flex-col gap-1">
				{visibleLogs.length === 0 ? (
					<div className="text-xs text-text-tertiary">No logs match "{filter}".</div>
				) : (
					visibleLogs.map((log) => (
						<ExperimentLogEntry key={log.relativePath} log={log} workspaceId={workspaceId} taskId={taskId} />
					))
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCheckName(check: string): string {
	return check.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const totalSeconds = ms / 1000;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.round(totalSeconds - minutes * 60);
	if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const restMin = minutes - hours * 60;
	return restMin > 0 ? `${hours}h ${restMin}m` : `${hours}h`;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelativeTime(value: string | undefined): string | null {
	if (!value) return null;
	const ts = Date.parse(value);
	if (Number.isNaN(ts)) return null;
	const diffMs = Date.now() - ts;
	if (diffMs < 0) return new Date(ts).toLocaleString();
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
}

function isDeliverableParsed(value: unknown): value is DeliverableParsed {
	return value !== null && typeof value === "object" && "taskId" in value && "summary" in value;
}

function isValidationReport(value: unknown): value is ValidationReport {
	return value !== null && typeof value === "object" && "taskId" in value && "result" in value && "checks" in value;
}

function hasSpecStaleness(report: ValidationReport): boolean {
	return report.checks.some((c) => c.check === "spec_staleness" && c.status === "needs_review");
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ReviewOutcome = "accepted" | "rejected" | "escalated";

const REVIEW_OUTCOME_LABEL: Record<ReviewOutcome, string> = {
	accepted: "Validation accepted.",
	rejected: "Validation rejected.",
	escalated: "Validation escalated for review.",
};

export function DeliverableValidationPanel({
	taskId,
	workspaceId,
	roadmapItemId,
	specSlug,
	ownedPaths,
	refreshToken,
	onSelectFile,
	availableFilePaths,
}: DeliverableValidationPanelProps): ReactElement | null {
	const {
		deliverable,
		validationReport,
		experimentLogs,
		reviewFeedback,
		validationHistory,
		isLoading,
		loadError,
		refetch,
	} = useDeliverableValidation(taskId, workspaceId, refreshToken);
	const [pendingReview, setPendingReview] = useState<ReviewOutcome | null>(null);
	const [isValidating, setIsValidating] = useState(false);
	const [noteDialogOutcome, setNoteDialogOutcome] = useState<"rejected" | "escalated" | null>(null);
	const [isResolvingFeedback, setIsResolvingFeedback] = useState(false);
	const mutationsAbortRef = useRef<AbortController | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		mutationsAbortRef.current = controller;
		return () => {
			controller.abort();
		};
	}, [taskId]);
	const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

	const parsed = deliverable?.parsed;
	const report = validationReport?.report;

	const hasParsedDeliverable = isDeliverableParsed(parsed);
	const hasReport = isValidationReport(report);
	const hasExperiments = experimentLogs.length > 0;
	const priorFeedback = reviewFeedback?.feedback ?? null;

	const canRunValidation =
		!isValidating &&
		workspaceId != null &&
		hasParsedDeliverable &&
		roadmapItemId != null &&
		specSlug != null &&
		ownedPaths != null;

	const submitReview = useCallback(
		async (outcome: ReviewOutcome, note?: string) => {
			if (!workspaceId || !roadmapItemId) return;
			const signal = mutationsAbortRef.current?.signal;
			setPendingReview(outcome);
			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				await trpc.runtime.reviewValidation.mutate(
					{ taskId, roadmapItemId, outcome, ...(note ? { note } : {}) },
					{ signal },
				);
				if (isAborted(signal)) return;
				showAppToast({ intent: "success", message: REVIEW_OUTCOME_LABEL[outcome], timeout: 3000 });
				refetch();
			} catch (error) {
				if (isAborted(signal)) return;
				const message = error instanceof Error ? error.message : "Failed to record review.";
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 6000 });
			} finally {
				if (!isAborted(signal)) setPendingReview(null);
			}
		},
		[workspaceId, roadmapItemId, taskId, refetch],
	);

	const handleReview = useCallback(
		(outcome: ReviewOutcome) => {
			if (outcome === "accepted") {
				void submitReview("accepted");
				return;
			}
			setNoteDialogOutcome(outcome);
		},
		[submitReview],
	);

	const handleRunValidation = useCallback(async () => {
		if (!workspaceId || !roadmapItemId || !specSlug || !ownedPaths) return;
		const signal = mutationsAbortRef.current?.signal;
		setIsValidating(true);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			await trpc.runtime.validateDeliverable.mutate({ taskId, specSlug, roadmapItemId, ownedPaths }, { signal });
			if (isAborted(signal)) return;
			showAppToast({ intent: "success", message: "Validation report generated.", timeout: 3000 });
			refetch();
		} catch (error) {
			if (isAborted(signal)) return;
			const message = error instanceof Error ? error.message : "Failed to run validation.";
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 6000 });
		} finally {
			if (!isAborted(signal)) setIsValidating(false);
		}
	}, [workspaceId, roadmapItemId, specSlug, ownedPaths, taskId, refetch]);

	const handleMarkFeedbackResolved = useCallback(async () => {
		if (!workspaceId) return;
		const signal = mutationsAbortRef.current?.signal;
		setIsResolvingFeedback(true);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			await trpc.runtime.clearReviewFeedback.mutate({ taskId }, { signal });
			if (isAborted(signal)) return;
			refetch();
		} catch (error) {
			if (isAborted(signal)) return;
			const message = error instanceof Error ? error.message : "Failed to clear feedback.";
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 4000 });
		} finally {
			if (!isAborted(signal)) setIsResolvingFeedback(false);
		}
	}, [workspaceId, taskId, refetch]);

	const reportNeedsReview =
		isValidationReport(report) && (report.result === "fail" || report.result === "needs_review");
	const hotkeysActive = reportNeedsReview && !noteDialogOutcome && pendingReview == null && roadmapItemId != null;
	useHotkeys(
		"a",
		(event) => {
			event.preventDefault();
			handleReview("accepted");
		},
		{ enabled: hotkeysActive, enableOnFormTags: false },
	);
	useHotkeys(
		"shift+r",
		(event) => {
			event.preventDefault();
			handleReview("rejected");
		},
		{ enabled: hotkeysActive, enableOnFormTags: false },
	);
	useHotkeys(
		"e",
		(event) => {
			event.preventDefault();
			handleReview("escalated");
		},
		{ enabled: hotkeysActive, enableOnFormTags: false },
	);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-3 border-t border-border px-3 py-3">
				<div className="flex items-center gap-2 text-xs text-text-tertiary">
					<Spinner size={12} />
					Loading deliverable data...
				</div>
			</div>
		);
	}

	const isRoadmapLinkedReviewCard = roadmapItemId != null;
	if (!hasParsedDeliverable && !hasReport && !hasExperiments && !isRoadmapLinkedReviewCard && !loadError) {
		return null;
	}

	const showStalenessWarning = hasReport && hasSpecStaleness(report);
	const deliverableMarkdown = deliverable?.markdown ?? null;
	const validationMarkdown = validationReport?.content ?? null;

	return (
		<div className="flex flex-col gap-4 border-t border-border px-3 py-3">
			{loadError ? <LoadErrorBanner message={loadError} onRetry={refetch} /> : null}
			{priorFeedback ? (
				<PriorFeedbackBanner
					feedback={priorFeedback}
					onMarkResolved={handleMarkFeedbackResolved}
					isResolving={isResolvingFeedback}
				/>
			) : null}
			{showStalenessWarning ? <StalenessWarning /> : null}
			{hasParsedDeliverable ? (
				<DeliverableSection
					parsed={parsed}
					rawMarkdown={deliverableMarkdown}
					onSelectFile={onSelectFile}
					availableFilePaths={availableFilePaths}
				/>
			) : isRoadmapLinkedReviewCard && !hasReport ? (
				<EmptyDeliverableState
					canRunValidation={canRunValidation}
					onRunValidation={handleRunValidation}
					isValidating={isValidating}
				/>
			) : null}
			<SubKpiSection taskId={taskId} workspaceId={workspaceId} refreshToken={refreshToken} />
			{hasReport ? (
				<ValidationReportSection
					report={report}
					rawMarkdown={validationMarkdown}
					onReview={roadmapItemId ? handleReview : undefined}
					reviewState={{ pending: pendingReview }}
				/>
			) : hasParsedDeliverable && canRunValidation ? (
				<div className="flex items-center gap-2">
					<Button
						variant="primary"
						size="sm"
						icon={isValidating ? <Spinner size={12} /> : <Play size={14} />}
						disabled={!canRunValidation}
						onClick={handleRunValidation}
					>
						Run validation
					</Button>
					<span className="text-xs text-text-tertiary">No validation report yet.</span>
				</div>
			) : null}
			{hasReport && !pendingReview && canRunValidation ? (
				<button
					type="button"
					onClick={handleRunValidation}
					disabled={!canRunValidation}
					className="inline-flex items-center gap-1 self-start text-[11px] text-text-tertiary hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
				>
					{isValidating ? <Spinner size={11} /> : <RotateCcw size={11} />}
					Re-run validation
				</button>
			) : null}
			{validationHistory.length > 1 ? <ValidationHistorySection history={validationHistory} /> : null}
			{hasExperiments ? (
				<ExperimentLogsSection logs={experimentLogs} workspaceId={workspaceId} taskId={taskId} />
			) : null}
			<ReviewNoteDialog
				outcome={noteDialogOutcome}
				onClose={() => setNoteDialogOutcome(null)}
				onSubmit={(note) => {
					const outcome = noteDialogOutcome;
					setNoteDialogOutcome(null);
					if (outcome) void submitReview(outcome, note);
				}}
			/>
		</div>
	);
}

function ValidationHistorySection({ history }: { history: ValidationHistoryResponse }): ReactElement | null {
	const [open, setOpen] = useState(false);
	if (history.length <= 1) return null;
	// The latest entry is already shown by ValidationReportSection; skip it here.
	const previous = history.slice(1);
	if (previous.length === 0) return null;

	return (
		<Collapsible.Root open={open} onOpenChange={setOpen}>
			<Collapsible.Trigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
				>
					{open ? (
						<ChevronDown size={12} className="text-text-tertiary" />
					) : (
						<ChevronRight size={12} className="text-text-tertiary" />
					)}
					Earlier validations
					<span className="ml-1 inline-flex items-center rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-tertiary">
						{previous.length}
					</span>
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<ul className="mt-1 flex flex-col gap-1">
					{previous.map((entry, i) => {
						const validatedRelative = formatRelativeTime(entry.validatedAt);
						const reviewedRelative = formatRelativeTime(entry.reviewedAt);
						return (
							<li
								key={`${entry.validatedAt}-${i}`}
								className="flex flex-col gap-0.5 rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs"
							>
								<div className="flex items-center gap-2">
									<ResultBadge result={entry.reportResult} />
									{validatedRelative ? (
										<span className="text-[10px] text-text-tertiary" title={entry.validatedAt}>
											validated {validatedRelative}
										</span>
									) : null}
									{entry.reviewOutcome ? (
										<span
											className={cn(
												"ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
												entry.reviewOutcome === "accepted" && "bg-status-green/15 text-status-green",
												entry.reviewOutcome === "rejected" && "bg-status-red/15 text-status-red",
												entry.reviewOutcome === "escalated" && "bg-status-orange/15 text-status-orange",
											)}
										>
											{entry.reviewOutcome}
											{reviewedRelative ? (
												<span className="ml-1 font-normal opacity-70">{reviewedRelative}</span>
											) : null}
										</span>
									) : (
										<span className="ml-auto text-[10px] text-text-tertiary">unreviewed</span>
									)}
								</div>
								{entry.reviewNote ? (
									<div className="whitespace-pre-wrap text-text-tertiary">{entry.reviewNote}</div>
								) : null}
							</li>
						);
					})}
				</ul>
			</Collapsible.Content>
		</Collapsible.Root>
	);
}

function PriorFeedbackBanner({
	feedback,
	onMarkResolved,
	isResolving,
}: {
	feedback: NonNullable<ReviewFeedbackResponse["feedback"]>;
	onMarkResolved?: () => void;
	isResolving: boolean;
}): ReactElement {
	const reviewedRelative = formatRelativeTime(feedback.reviewedAt);
	return (
		<div className="flex items-start gap-2 rounded-md border border-status-orange/30 bg-status-orange/10 px-3 py-2 text-xs text-status-orange">
			<AlertTriangle size={14} className="mt-0.5 shrink-0" />
			<div className="min-w-0 flex-1">
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1 font-medium">
						Previously {feedback.outcome === "rejected" ? "rejected" : "escalated"}
						{reviewedRelative ? (
							<span className="ml-1 font-normal text-text-tertiary">{reviewedRelative}</span>
						) : null}
					</div>
					{onMarkResolved ? (
						<button
							type="button"
							onClick={onMarkResolved}
							disabled={isResolving}
							className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-status-orange hover:bg-status-orange/15 disabled:opacity-40"
							title="Delete review-feedback.md"
						>
							{isResolving ? <Spinner size={10} /> : <Check size={11} />}
							Mark resolved
						</button>
					) : null}
				</div>
				{feedback.note ? (
					<div className="mt-0.5 whitespace-pre-wrap text-status-orange/80">{feedback.note}</div>
				) : null}
				<div className="mt-0.5 text-[10px] text-text-tertiary">
					review-feedback.md is in the worktree; the agent will read it on resume.
				</div>
			</div>
		</div>
	);
}

function ReviewNoteDialog({
	outcome,
	onClose,
	onSubmit,
}: {
	outcome: "rejected" | "escalated" | null;
	onClose: () => void;
	onSubmit: (note: string | undefined) => void;
}): ReactElement | null {
	const [note, setNote] = useState("");
	useEffect(() => {
		if (outcome) setNote("");
	}, [outcome]);

	if (!outcome) return null;

	const isRejected = outcome === "rejected";
	const title = isRejected ? "Reject validation" : "Escalate validation";
	const description = isRejected
		? "Tell the task agent what to fix. The note will be saved to review-feedback.md so the agent can pick it up on resume."
		: "Optionally explain what the human reviewer should look at.";

	const canSubmit = !isRejected || note.trim().length > 0;
	const handleSubmit = () => {
		if (!canSubmit) return;
		onSubmit(note.trim() || undefined);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			handleSubmit();
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()} contentClassName="max-w-md">
			<DialogHeader title={title} icon={isRejected ? <ThumbsDown size={14} /> : <AlertTriangle size={14} />} />
			<DialogBody>
				<p className="mb-2 text-xs text-text-tertiary">{description}</p>
				<textarea
					value={note}
					onChange={(event) => setNote(event.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder={isRejected ? "What should the agent change?" : "Optional note for the human reviewer"}
					rows={6}
					className="w-full resize-vertical rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					autoFocus
				/>
				<p className="mt-1 text-[10px] text-text-tertiary">
					Press <kbd className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono">⌘↵</kbd> /{" "}
					<kbd className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono">Ctrl+↵</kbd> to submit.
				</p>
			</DialogBody>
			<DialogFooter>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button variant={isRejected ? "danger" : "default"} size="sm" disabled={!canSubmit} onClick={handleSubmit}>
					{isRejected ? "Reject" : "Escalate"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
