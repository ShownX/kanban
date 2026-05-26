/**
 * KPI panel for a single roadmap item.
 *
 * Renders the snapshot from `useKpiSnapshot` (definitions + readings +
 * evaluated status) and gives the reviewer two interactions:
 *   - record a manual reading (opens an inline form)
 *   - apply an override (mark met / waived / clear)
 *
 * Auto-promote-blocking KPIs are surfaced in a banner at the top so a
 * reviewer can see at a glance why an item isn't yet "done".
 */

import type { RuntimeKpiOverride, RuntimeKpiSnapshot, RuntimeProjectKpi } from "@runtime-contract";
import { AlertCircle, CheckCircle2, CircleDashed, MinusCircle, RefreshCw, ShieldOff, XCircle } from "lucide-react";
import { type ReactElement, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useKpiSnapshot } from "./use-kpi-snapshot";

type KpiStatus = RuntimeProjectKpi extends { override?: { status: infer S } } ? S : never;

interface KpiPanelProps {
	roadmapItemId: string | null;
	workspaceId: string | null;
}

export function KpiPanel({ roadmapItemId, workspaceId }: KpiPanelProps): ReactElement {
	const { snapshot, loading, error, reload } = useKpiSnapshot(roadmapItemId, workspaceId);

	if (!roadmapItemId) {
		return (
			<div className="flex flex-1 items-center justify-center text-text-tertiary text-sm py-16">
				Select a roadmap item to view its KPIs.
			</div>
		);
	}

	if (loading && !snapshot) {
		return (
			<div className="flex flex-1 items-center justify-center py-16">
				<Spinner size={20} />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-1 items-center justify-center text-status-red text-sm py-16">
				Failed to load KPIs: {error}
			</div>
		);
	}

	if (!snapshot || snapshot.kpis.length === 0) {
		return <KpiEmptyState onRefresh={reload} />;
	}

	return (
		<div className="flex-1 min-w-0 overflow-y-auto bg-surface-0 p-6">
			<div className="max-w-3xl mx-auto space-y-4">
				<KpiPanelHeader snapshot={snapshot} onRefresh={reload} loading={loading} />
				{snapshot.warnings.length > 0 ? <KpiWarningsBanner warnings={snapshot.warnings} /> : null}
				{!snapshot.allMet ? <KpiBlockingBanner blocking={snapshot.blockingKpis} /> : null}
				<ul className="space-y-3">
					{snapshot.kpis.map((entry) => (
						<KpiRow
							key={entry.definition.id}
							entry={entry}
							roadmapItemId={roadmapItemId}
							workspaceId={workspaceId}
							onMutated={reload}
						/>
					))}
				</ul>
			</div>
		</div>
	);
}

function KpiEmptyState({ onRefresh }: { onRefresh: () => Promise<void> }): ReactElement {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-tertiary text-sm py-16">
			<p>No KPIs declared on this roadmap item.</p>
			<p className="text-xs text-text-tertiary">
				Add a <code className="bg-surface-2 px-1 rounded-sm">### KPIs</code> section to{" "}
				<code className="bg-surface-2 px-1 rounded-sm">.kanban/kpis/&lt;item-id&gt;.md</code>.
			</p>
			<Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void onRefresh()}>
				Refresh
			</Button>
		</div>
	);
}

function KpiPanelHeader({
	snapshot,
	onRefresh,
	loading,
}: {
	snapshot: RuntimeKpiSnapshot;
	onRefresh: () => Promise<void>;
	loading: boolean;
}): ReactElement {
	const total = snapshot.kpis.length;
	const met = snapshot.kpis.filter((e) => e.evaluation.status === "met").length;
	const waived = snapshot.kpis.filter((e) => e.evaluation.status === "waived").length;
	return (
		<div className="flex items-center justify-between gap-2">
			<div>
				<h2 className="text-sm font-semibold text-text-primary">KPIs · {snapshot.itemId}</h2>
				<p className="text-xs text-text-tertiary mt-1">
					{met}/{total} met{waived > 0 ? ` · ${waived} waived` : ""}
				</p>
			</div>
			<Button
				size="sm"
				variant="ghost"
				icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
				onClick={() => void onRefresh()}
			>
				Refresh
			</Button>
		</div>
	);
}

function KpiBlockingBanner({ blocking }: { blocking: string[] }): ReactElement {
	return (
		<div className="flex items-start gap-2 px-3 py-2 rounded-md border border-border bg-surface-2 text-xs text-text-secondary">
			<AlertCircle size={14} className="mt-0.5 text-status-orange shrink-0" />
			<div>
				<div className="font-medium text-text-primary">Auto-promote blocked</div>
				<div className="mt-0.5">
					{blocking.length} KPI{blocking.length === 1 ? "" : "s"} not yet met or waived: {blocking.join(", ")}.
				</div>
			</div>
		</div>
	);
}

function KpiWarningsBanner({ warnings }: { warnings: string[] }): ReactElement {
	return (
		<div className="flex items-start gap-2 px-3 py-2 rounded-md border border-border bg-surface-2 text-xs text-text-secondary">
			<AlertCircle size={14} className="mt-0.5 text-status-orange shrink-0" />
			<div>
				<div className="font-medium text-text-primary">KPI markdown warnings</div>
				<ul className="mt-0.5 list-disc list-inside">
					{warnings.map((w) => (
						<li key={w}>{w}</li>
					))}
				</ul>
			</div>
		</div>
	);
}

interface KpiRowProps {
	entry: RuntimeKpiSnapshot["kpis"][number];
	roadmapItemId: string;
	workspaceId: string | null;
	onMutated: () => Promise<void>;
}

function KpiRow({ entry, roadmapItemId, workspaceId, onMutated }: KpiRowProps): ReactElement {
	const [showRecord, setShowRecord] = useState(false);
	const [showOverride, setShowOverride] = useState(false);
	const status = entry.evaluation.status;
	const targetText = formatTarget(entry.definition);
	const value = formatValue(entry.evaluation.aggregatedValue);

	return (
		<li className="rounded-md border border-border bg-surface-1 p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-medium text-text-primary">
						<StatusBadge status={status} />
						<span className="truncate">{entry.definition.label}</span>
						<span className="text-text-tertiary text-xs font-normal">({entry.definition.id})</span>
					</div>
					<div className="text-xs text-text-tertiary mt-1">
						target: <span className="text-text-secondary">{targetText}</span>
						{value !== null ? (
							<>
								{" · "}value: <span className="text-text-secondary">{value}</span>
							</>
						) : (
							<>
								{" · "}
								<span className="italic">no readings</span>
							</>
						)}
						{entry.definition.acceptance !== "manual" ? (
							<>
								{" · "}acceptance: <span className="text-text-secondary">{entry.definition.acceptance}</span>
							</>
						) : null}
					</div>
					{entry.evaluation.warnings.length > 0 ? (
						<div className="text-xs text-status-orange mt-1">{entry.evaluation.warnings.join(" ")}</div>
					) : null}
					{entry.definition.override ? (
						<div className="text-xs text-text-tertiary mt-1">
							Override: <span className="text-text-secondary">{entry.definition.override.status}</span> ·{" "}
							{entry.definition.override.reviewer} · {entry.definition.override.reason}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 gap-1">
					<Button size="sm" variant="ghost" onClick={() => setShowRecord((v) => !v)}>
						Record
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setShowOverride((v) => !v)}>
						Override
					</Button>
				</div>
			</div>
			{showRecord ? (
				<RecordReadingForm
					kpi={entry.definition}
					roadmapItemId={roadmapItemId}
					workspaceId={workspaceId}
					onClose={() => setShowRecord(false)}
					onSubmitted={async () => {
						setShowRecord(false);
						await onMutated();
					}}
				/>
			) : null}
			{showOverride ? (
				<OverrideForm
					kpi={entry.definition}
					roadmapItemId={roadmapItemId}
					workspaceId={workspaceId}
					onClose={() => setShowOverride(false)}
					onSubmitted={async () => {
						setShowOverride(false);
						await onMutated();
					}}
				/>
			) : null}
		</li>
	);
}

function StatusBadge({ status }: { status: KpiStatus }): ReactElement {
	const meta = STATUS_META[status];
	const Icon = meta.icon;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium uppercase tracking-wider",
				meta.className,
			)}
		>
			<Icon size={10} />
			{status}
		</span>
	);
}

const STATUS_META: Record<KpiStatus, { icon: typeof CheckCircle2; className: string }> = {
	met: { icon: CheckCircle2, className: "bg-status-green/15 text-status-green" },
	missed: { icon: XCircle, className: "bg-status-red/15 text-status-red" },
	waived: { icon: ShieldOff, className: "bg-status-purple/15 text-status-purple" },
	open: { icon: CircleDashed, className: "bg-surface-2 text-text-secondary" },
};

function formatTarget(kpi: RuntimeProjectKpi): string {
	switch (kpi.target.kind) {
		case "boolean":
			return "boolean";
		case "numeric": {
			const unit = kpi.target.unit ? kpi.target.unit : "";
			return `${kpi.target.op}${kpi.target.value}${unit}`;
		}
		case "rubric":
			return `rubric ≥ ${kpi.target.minimum}`;
	}
}

function formatValue(value: boolean | number | string | null): string | null {
	if (value === null) return null;
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}

interface RecordReadingFormProps {
	kpi: RuntimeProjectKpi;
	roadmapItemId: string;
	workspaceId: string | null;
	onClose: () => void;
	onSubmitted: () => Promise<void>;
}

function RecordReadingForm({
	kpi,
	roadmapItemId,
	workspaceId,
	onClose,
	onSubmitted,
}: RecordReadingFormProps): ReactElement {
	const [valueText, setValueText] = useState("");
	const [note, setNote] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const reading = parseReadingValue(kpi, valueText, note);
			const trpc = getRuntimeTrpcClient(workspaceId);
			await trpc.runtime.recordKpiReading.mutate({ roadmapItemId, kpiId: kpi.id, reading });
			await onSubmitted();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="mt-3 pt-3 border-t border-border space-y-2">
			<label className="block text-xs text-text-tertiary">
				Value
				<input
					className="mt-1 w-full px-2 py-1 rounded-sm bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus"
					value={valueText}
					onChange={(e) => setValueText(e.target.value)}
					placeholder={placeholderForKpi(kpi)}
				/>
			</label>
			<label className="block text-xs text-text-tertiary">
				Note (optional)
				<input
					className="mt-1 w-full px-2 py-1 rounded-sm bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus"
					value={note}
					onChange={(e) => setNote(e.target.value)}
				/>
			</label>
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

interface OverrideFormProps {
	kpi: RuntimeProjectKpi;
	roadmapItemId: string;
	workspaceId: string | null;
	onClose: () => void;
	onSubmitted: () => Promise<void>;
}

function OverrideForm({ kpi, roadmapItemId, workspaceId, onClose, onSubmitted }: OverrideFormProps): ReactElement {
	const [status, setStatus] = useState<KpiStatus>("waived");
	const [reason, setReason] = useState("");
	const [reviewer, setReviewer] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const override: RuntimeKpiOverride = {
				status,
				reason: reason.trim(),
				reviewer: reviewer.trim(),
				decidedAt: new Date().toISOString(),
			};
			const trpc = getRuntimeTrpcClient(workspaceId);
			await trpc.runtime.setKpiOverride.mutate({ roadmapItemId, kpiId: kpi.id, override });
			await onSubmitted();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	const clear = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const trpc = getRuntimeTrpcClient(workspaceId);
			await trpc.runtime.clearKpiOverride.mutate({ roadmapItemId, kpiId: kpi.id });
			await onSubmitted();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="mt-3 pt-3 border-t border-border space-y-2">
			<label className="block text-xs text-text-tertiary">
				Status
				<select
					className="mt-1 w-full px-2 py-1 rounded-sm bg-surface-2 border border-border text-sm text-text-primary"
					value={status}
					onChange={(e) => setStatus(e.target.value as KpiStatus)}
				>
					<option value="met">met</option>
					<option value="missed">missed</option>
					<option value="waived">waived</option>
					<option value="open">open</option>
				</select>
			</label>
			<label className="block text-xs text-text-tertiary">
				Reviewer
				<input
					className="mt-1 w-full px-2 py-1 rounded-sm bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus"
					value={reviewer}
					onChange={(e) => setReviewer(e.target.value)}
					placeholder="@yourname"
				/>
			</label>
			<label className="block text-xs text-text-tertiary">
				Reason
				<textarea
					className="mt-1 w-full px-2 py-1 rounded-sm bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus"
					rows={2}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</label>
			{error ? <div className="text-xs text-status-red">{error}</div> : null}
			<div className="flex gap-2 justify-between">
				<Button
					size="sm"
					variant="ghost"
					icon={<MinusCircle size={14} />}
					disabled={submitting || !kpi.override}
					onClick={() => void clear()}
				>
					Clear override
				</Button>
				<div className="flex gap-2">
					<Button size="sm" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={submitting || !reason.trim() || !reviewer.trim()}
						onClick={() => void submit()}
					>
						{submitting ? "Applying…" : "Apply override"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function placeholderForKpi(kpi: RuntimeProjectKpi): string {
	switch (kpi.target.kind) {
		case "boolean":
			return "true or false";
		case "numeric":
			return `e.g. 178${kpi.target.unit ? ` (${kpi.target.unit})` : ""}`;
		case "rubric":
			return kpi.target.levels.join(" / ");
	}
}

function parseReadingValue(
	kpi: RuntimeProjectKpi,
	rawValue: string,
	note: string,
): RuntimeKpiSnapshot["kpis"][number]["definition"]["readings"][number] {
	const recordedAt = new Date().toISOString();
	const trimmed = rawValue.trim();
	const noteField = note.trim() ? { note: note.trim() } : {};
	switch (kpi.target.kind) {
		case "boolean": {
			if (trimmed === "true") return { recordedAt, source: "manual", booleanValue: true, ...noteField };
			if (trimmed === "false") return { recordedAt, source: "manual", booleanValue: false, ...noteField };
			throw new Error(`Boolean KPI expects "true" or "false"; got "${trimmed}".`);
		}
		case "numeric": {
			const numeric = Number.parseFloat(trimmed);
			if (Number.isNaN(numeric)) throw new Error(`Numeric KPI expects a number; got "${trimmed}".`);
			return { recordedAt, source: "manual", numericValue: numeric, ...noteField };
		}
		case "rubric": {
			if (!kpi.target.levels.includes(trimmed)) {
				throw new Error(`Rubric KPI expects one of ${kpi.target.levels.join(", ")}.`);
			}
			return { recordedAt, source: "manual", rubricValue: trimmed, ...noteField };
		}
	}
}
