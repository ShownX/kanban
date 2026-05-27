/**
 * Sub-KPIs section for the deliverable validation panel.
 *
 * Shows the sub-KPIs declared on a task (`.kanban/kpis/tasks/<taskId>.md`)
 * along with their latest readings and which parent project KPI each
 * rolls up to. Lets the reviewer record a manual sub-KPI reading
 * inline before accepting the validation.
 *
 * Read-only when the task has no sub-KPI markdown — the validator's
 * `kpi_coverage` check already surfaces missing readings before the
 * reviewer reaches accept, so the section is informational here.
 */

import type { RuntimeKpiTarget, RuntimeTaskSubKpi } from "@runtime-contract";
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, RefreshCw, XCircle } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface SubKpiSectionProps {
	taskId: string;
	workspaceId: string | null;
	/** Bumping this token forces a refetch (e.g. when validation re-runs). */
	refreshToken?: number;
}

export function SubKpiSection({ taskId, workspaceId, refreshToken }: SubKpiSectionProps): ReactElement | null {
	const [open, setOpen] = useState(true);
	const [subKpis, setSubKpis] = useState<RuntimeTaskSubKpi[]>([]);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		if (!workspaceId) return;
		setLoading(true);
		setError(null);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			const result = await trpc.runtime.getTaskSubKpis.query({ taskId });
			setSubKpis(result.subKpis);
			setWarnings(result.warnings);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [taskId, workspaceId]);

	useEffect(() => {
		void reload();
	}, [reload, refreshToken]);

	if (subKpis.length === 0 && !loading && !error) return null;

	return (
		<section className="rounded-md border border-border bg-surface-1">
			<button
				type="button"
				className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
				onClick={() => setOpen((v) => !v)}
			>
				<div className="flex items-center gap-2">
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					<span className="text-sm font-medium text-text-primary">Sub-KPIs</span>
					<span className="text-xs text-text-tertiary">
						{subKpis.length} declared
						{subKpis.filter((k) => k.readings.length > 0).length}/{subKpis.length} measured
					</span>
				</div>
				{loading ? <Spinner size={12} /> : null}
			</button>
			{open ? (
				<div className="border-t border-border px-3 py-3 space-y-2">
					{error ? <div className="text-xs text-status-red">{error}</div> : null}
					{warnings.length > 0 ? (
						<div className="text-xs text-status-orange">
							{warnings.length} markdown warning(s): {warnings.join("; ")}
						</div>
					) : null}
					{subKpis.length === 0 && !loading ? (
						<div className="text-xs text-text-tertiary">No sub-KPIs declared on this task.</div>
					) : null}
					{subKpis.map((sub) => (
						<SubKpiRow key={sub.id} sub={sub} taskId={taskId} workspaceId={workspaceId} onMutated={reload} />
					))}
					<div className="flex justify-end pt-1">
						<Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void reload()}>
							Refresh
						</Button>
					</div>
				</div>
			) : null}
		</section>
	);
}

function SubKpiRow({
	sub,
	taskId,
	workspaceId,
	onMutated,
}: {
	sub: RuntimeTaskSubKpi;
	taskId: string;
	workspaceId: string | null;
	onMutated: () => Promise<void>;
}): ReactElement {
	const [showRecord, setShowRecord] = useState(false);
	const latest = sub.readings.length > 0 ? sub.readings[sub.readings.length - 1] : null;
	const status: "met" | "missed" | "open" = (() => {
		if (!latest) return "open";
		if (sub.target.kind === "boolean" && latest.booleanValue !== undefined) {
			return latest.booleanValue ? "met" : "missed";
		}
		if (sub.target.kind === "numeric" && latest.numericValue !== undefined) {
			return checkNumericTarget(sub.target, latest.numericValue) ? "met" : "missed";
		}
		if (sub.target.kind === "rubric" && latest.rubricValue !== undefined) {
			return checkRubricTarget(sub.target, latest.rubricValue) ? "met" : "missed";
		}
		return "open";
	})();
	return (
		<div className="rounded-sm border border-border bg-surface-2 p-2">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs">
						<StatusGlyph status={status} />
						<span className="font-medium text-text-primary truncate">{sub.label}</span>
						<span className="text-text-tertiary">({sub.id})</span>
					</div>
					<div className="text-xs text-text-tertiary mt-0.5">
						target: <span className="text-text-secondary">{formatTarget(sub.target)}</span>
						{latest ? (
							<>
								{" · "}value: <span className="text-text-secondary">{formatLatestValue(latest)}</span>
							</>
						) : (
							<>
								{" · "}
								<span className="italic">no readings</span>
							</>
						)}
						{sub.parentKpiId ? (
							<>
								{" · rolls up to "}
								<span className="text-text-secondary">{sub.parentKpiId}</span>
							</>
						) : (
							<>
								{" · "}
								<span className="italic">informational</span>
							</>
						)}
					</div>
				</div>
				<Button size="sm" variant="ghost" onClick={() => setShowRecord((v) => !v)}>
					Record
				</Button>
			</div>
			{showRecord ? (
				<RecordSubKpiForm
					sub={sub}
					taskId={taskId}
					workspaceId={workspaceId}
					onClose={() => setShowRecord(false)}
					onSubmitted={async () => {
						setShowRecord(false);
						await onMutated();
					}}
				/>
			) : null}
		</div>
	);
}

function RecordSubKpiForm({
	sub,
	taskId,
	workspaceId,
	onClose,
	onSubmitted,
}: {
	sub: RuntimeTaskSubKpi;
	taskId: string;
	workspaceId: string | null;
	onClose: () => void;
	onSubmitted: () => Promise<void>;
}): ReactElement {
	const [valueText, setValueText] = useState("");
	const [note, setNote] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const reading = parseSubKpiReading(sub, valueText, note);
			const trpc = getRuntimeTrpcClient(workspaceId);
			await trpc.runtime.recordSubKpiReading.mutate({ taskId, subKpiId: sub.id, reading });
			await onSubmitted();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="mt-2 pt-2 border-t border-border space-y-1.5">
			<input
				className="w-full px-2 py-1 rounded-sm bg-surface-3 border border-border text-xs text-text-primary outline-none focus:border-border-focus"
				value={valueText}
				onChange={(e) => setValueText(e.target.value)}
				placeholder={placeholderForTarget(sub.target)}
			/>
			<input
				className="w-full px-2 py-1 rounded-sm bg-surface-3 border border-border text-xs text-text-primary outline-none focus:border-border-focus"
				value={note}
				onChange={(e) => setNote(e.target.value)}
				placeholder="Note (optional)"
			/>
			{error ? <div className="text-xs text-status-red">{error}</div> : null}
			<div className="flex gap-2 justify-end">
				<Button size="sm" variant="ghost" onClick={onClose}>
					Cancel
				</Button>
				<Button
					size="sm"
					variant="primary"
					disabled={submitting || !valueText.trim()}
					onClick={() => void submit()}
				>
					{submitting ? "Recording…" : "Record"}
				</Button>
			</div>
		</div>
	);
}

function StatusGlyph({ status }: { status: "met" | "missed" | "open" }): ReactElement {
	const meta = STATUS_META[status];
	const Icon = meta.icon;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 px-1 py-0.5 rounded-sm text-[10px] font-medium uppercase",
				meta.className,
			)}
		>
			<Icon size={10} />
			{status}
		</span>
	);
}

const STATUS_META: Record<"met" | "missed" | "open", { icon: typeof CheckCircle2; className: string }> = {
	met: { icon: CheckCircle2, className: "bg-status-green/15 text-status-green" },
	missed: { icon: XCircle, className: "bg-status-red/15 text-status-red" },
	open: { icon: CircleDashed, className: "bg-surface-3 text-text-secondary" },
};

function formatTarget(target: RuntimeKpiTarget): string {
	switch (target.kind) {
		case "boolean":
			return "boolean";
		case "numeric":
			return `${target.op}${target.value}${target.unit ?? ""}`;
		case "rubric":
			return `rubric ≥ ${target.minimum}`;
	}
}

function formatLatestValue(reading: RuntimeTaskSubKpi["readings"][number]): string {
	if (reading.booleanValue !== undefined) return String(reading.booleanValue);
	if (reading.numericValue !== undefined) return String(reading.numericValue);
	if (reading.rubricValue !== undefined) return reading.rubricValue;
	return "—";
}

function placeholderForTarget(target: RuntimeKpiTarget): string {
	switch (target.kind) {
		case "boolean":
			return "true or false";
		case "numeric":
			return `e.g. 178${target.unit ? ` (${target.unit})` : ""}`;
		case "rubric":
			return target.levels.join(" / ");
	}
}

function parseSubKpiReading(
	sub: RuntimeTaskSubKpi,
	rawValue: string,
	note: string,
): RuntimeTaskSubKpi["readings"][number] {
	const recordedAt = new Date().toISOString();
	const trimmed = rawValue.trim();
	const noteField = note.trim() ? { note: note.trim() } : {};
	switch (sub.target.kind) {
		case "boolean": {
			if (trimmed === "true") return { recordedAt, source: "manual", booleanValue: true, ...noteField };
			if (trimmed === "false") return { recordedAt, source: "manual", booleanValue: false, ...noteField };
			throw new Error('Boolean sub-KPI expects "true" or "false".');
		}
		case "numeric": {
			const numeric = Number.parseFloat(trimmed);
			if (Number.isNaN(numeric)) throw new Error("Numeric sub-KPI expects a number.");
			return { recordedAt, source: "manual", numericValue: numeric, ...noteField };
		}
		case "rubric": {
			if (!sub.target.levels.includes(trimmed)) {
				throw new Error(`Rubric sub-KPI expects one of ${sub.target.levels.join(", ")}.`);
			}
			return { recordedAt, source: "manual", rubricValue: trimmed, ...noteField };
		}
	}
}

function checkNumericTarget(target: Extract<RuntimeKpiTarget, { kind: "numeric" }>, value: number): boolean {
	switch (target.op) {
		case ">=":
			return value >= target.value;
		case "<=":
			return value <= target.value;
		case "==":
			return value === target.value;
		case "<":
			return value < target.value;
		case ">":
			return value > target.value;
	}
}

function checkRubricTarget(target: Extract<RuntimeKpiTarget, { kind: "rubric" }>, value: string): boolean {
	const order = new Map(target.levels.map((level, idx) => [level, idx]));
	const valueIdx = order.get(value);
	const minimumIdx = order.get(target.minimum);
	if (valueIdx === undefined || minimumIdx === undefined) return false;
	return valueIdx >= minimumIdx;
}
