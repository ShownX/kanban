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
	FileText,
	FlaskConical,
	HelpCircle,
	Shield,
	Terminal,
	X,
	XCircle,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

// ---------------------------------------------------------------------------
// Types derived from the tRPC router
// ---------------------------------------------------------------------------

type RouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
type DeliverableResponse = RouterOutputs["runtime"]["readDeliverable"];
type ValidationReportResponse = RouterOutputs["runtime"]["readValidationReport"];
type ExperimentLogsResponse = RouterOutputs["runtime"]["readExperimentLogs"];

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
}

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

interface DeliverableValidationData {
	deliverable: DeliverableResponse | null;
	validationReport: ValidationReportResponse | null;
	experimentLogs: ExperimentLogsResponse;
	isLoading: boolean;
}

function useDeliverableValidation(taskId: string, workspaceId: string | null): DeliverableValidationData {
	const [deliverable, setDeliverable] = useState<DeliverableResponse | null>(null);
	const [validationReport, setValidationReport] = useState<ValidationReportResponse | null>(null);
	const [experimentLogs, setExperimentLogs] = useState<ExperimentLogsResponse>([]);
	const [isLoading, setIsLoading] = useState(true);
	const isMountedRef = useRef(true);

	const fetchData = useCallback(() => {
		if (!workspaceId) {
			setIsLoading(false);
			return;
		}

		const trpc = getRuntimeTrpcClient(workspaceId);

		const deliverablePromise = trpc.runtime.readDeliverable
			.query({ taskId })
			.then((result) => {
				if (isMountedRef.current) setDeliverable(result);
			})
			.catch(() => {
				if (isMountedRef.current) setDeliverable(null);
			});

		const reportPromise = trpc.runtime.readValidationReport
			.query({ taskId })
			.then((result) => {
				if (isMountedRef.current) setValidationReport(result);
			})
			.catch(() => {
				if (isMountedRef.current) setValidationReport(null);
			});

		const experimentsPromise = trpc.runtime.readExperimentLogs
			.query({ taskId })
			.then((result) => {
				if (isMountedRef.current) setExperimentLogs(result);
			})
			.catch(() => {
				if (isMountedRef.current) setExperimentLogs([]);
			});

		void Promise.all([deliverablePromise, reportPromise, experimentsPromise]).then(() => {
			if (isMountedRef.current) setIsLoading(false);
		});
	}, [taskId, workspaceId]);

	useEffect(() => {
		isMountedRef.current = true;
		setIsLoading(true);
		setDeliverable(null);
		setValidationReport(null);
		setExperimentLogs([]);
		fetchData();
		return () => {
			isMountedRef.current = false;
		};
	}, [fetchData]);

	return { deliverable, validationReport, experimentLogs, isLoading };
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

function StalenessWarning(): ReactElement {
	return (
		<div className="flex items-start gap-2 rounded-md border border-status-orange/30 bg-status-orange/10 px-3 py-2 text-xs text-status-orange">
			<AlertTriangle size={14} className="mt-0.5 shrink-0" />
			<span>The spec was updated after this deliverable was written. The requirements check may be outdated.</span>
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

function DeliverableSection({ parsed }: { parsed: DeliverableParsed }): ReactElement {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<FileText size={13} />
				Deliverable
			</div>

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
						{parsed.changedFiles.map((file) => (
							<div key={file} className="truncate text-xs font-mono text-text-tertiary" title={file}>
								{file}
							</div>
						))}
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
		</div>
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

function ValidationReportSection({ report }: { report: ValidationReport }): ReactElement {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<Shield size={13} />
				Validation
				<ResultBadge result={report.result} />
			</div>

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
			{report.summary ? <div className="text-xs text-text-tertiary leading-relaxed">{report.summary}</div> : null}
		</div>
	);
}

function ExperimentLogEntry({ log }: { log: ExperimentLog }): ReactElement {
	const [open, setOpen] = useState(false);
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
						{log.truncated ? " (truncated)" : ""}
					</span>
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-0 px-2 py-1.5 font-mono text-[11px] leading-snug text-text-secondary">
					{log.content}
				</pre>
			</Collapsible.Content>
		</Collapsible.Root>
	);
}

function ExperimentLogsSection({ logs }: { logs: ExperimentLog[] }): ReactElement {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
				<FlaskConical size={13} />
				Experiment Logs
				<span className="ml-1 inline-flex items-center rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-text-tertiary">
					{logs.length}
				</span>
			</div>
			<div className="flex flex-col gap-1">
				{logs.map((log) => (
					<ExperimentLogEntry key={log.relativePath} log={log} />
				))}
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

export function DeliverableValidationPanel({
	taskId,
	workspaceId,
}: DeliverableValidationPanelProps): ReactElement | null {
	const { deliverable, validationReport, experimentLogs, isLoading } = useDeliverableValidation(taskId, workspaceId);

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

	const parsed = deliverable?.parsed;
	const report = validationReport?.report;

	const hasParsedDeliverable = isDeliverableParsed(parsed);
	const hasReport = isValidationReport(report);
	const hasExperiments = experimentLogs.length > 0;

	if (!hasParsedDeliverable && !hasReport && !hasExperiments) {
		return null;
	}

	const showStalenessWarning = hasReport && hasSpecStaleness(report);

	return (
		<div className="flex flex-col gap-4 border-t border-border px-3 py-3">
			{showStalenessWarning ? <StalenessWarning /> : null}
			{hasParsedDeliverable ? <DeliverableSection parsed={parsed} /> : null}
			{hasReport ? <ValidationReportSection report={report} /> : null}
			{hasExperiments ? <ExperimentLogsSection logs={experimentLogs} /> : null}
		</div>
	);
}
