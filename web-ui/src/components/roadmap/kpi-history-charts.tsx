/**
 * Tiny SVG chart primitives for the KPI History tab.
 *
 * Avoids pulling in a chart library (recharts/victory/etc) for what's
 * essentially three small static charts on bounded data. The KPI event
 * log realistically caps at hundreds of points per item, so manual
 * SVG keeps the bundle smaller and the styling lined up with the dark
 * theme tokens by default.
 */

import type {
	RuntimeKpiBurndownPoint,
	RuntimeKpiCycleTimeEntry,
	RuntimeKpiRegressionEntry,
	RuntimeKpiVelocityBucket,
} from "@runtime-contract";
import type { ReactElement } from "react";

const CHART_W = 480;
const CHART_H = 120;
const PAD = { top: 8, right: 12, bottom: 20, left: 30 };

export function BurndownChart({ points }: { points: readonly RuntimeKpiBurndownPoint[] }): ReactElement {
	if (points.length < 2) return <ChartEmpty label="Burndown" reason="Needs at least two transitions to plot." />;
	const totalKpis = Math.max(...points.map((p) => p.totalKpis));
	const xScale = scaleX(points.map((p) => Date.parse(p.ts)));
	const yScale = scaleY(0, totalKpis);
	const path = points
		.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(Date.parse(p.ts))} ${yScale(p.metKpis)}`)
		.join(" ");
	return (
		<ChartFrame title={`Burndown — ${points[points.length - 1]!.metKpis}/${totalKpis} met`}>
			<YAxisLabels max={totalKpis} />
			<path d={path} fill="none" stroke="var(--color-status-green)" strokeWidth={1.5} />
			{points.map((p) => (
				<circle
					key={`${p.ts}-${p.metKpis}`}
					cx={xScale(Date.parse(p.ts))}
					cy={yScale(p.metKpis)}
					r={2}
					fill="var(--color-status-green)"
				/>
			))}
		</ChartFrame>
	);
}

export function VelocityChart({ buckets }: { buckets: readonly RuntimeKpiVelocityBucket[] }): ReactElement {
	if (buckets.length === 0) return <ChartEmpty label="Velocity" reason="No KPIs flipped to met in the window." />;
	const maxCount = Math.max(...buckets.map((b) => b.metCount));
	const innerW = CHART_W - PAD.left - PAD.right;
	const barW = Math.max(4, Math.floor(innerW / buckets.length) - 4);
	return (
		<ChartFrame
			title={`Velocity — ${buckets.reduce((a, b) => a + b.metCount, 0)} met (last ${buckets.length} day${buckets.length === 1 ? "" : "s"})`}
		>
			<YAxisLabels max={maxCount} />
			{buckets.map((b, i) => {
				const x = PAD.left + i * (innerW / buckets.length) + 2;
				const h = (b.metCount / maxCount) * (CHART_H - PAD.top - PAD.bottom);
				const y = CHART_H - PAD.bottom - h;
				return (
					<rect key={b.day} x={x} y={y} width={barW} height={h} fill="var(--color-status-blue)" rx={1}>
						<title>{`${b.day}: ${b.metCount} met`}</title>
					</rect>
				);
			})}
		</ChartFrame>
	);
}

export function CycleTimeList({ entries }: { entries: readonly RuntimeKpiCycleTimeEntry[] }): ReactElement {
	if (entries.length === 0) {
		return <ChartEmpty label="Cycle time" reason="No KPI has reached `met` yet." />;
	}
	const sorted = [...entries].sort((a, b) => a.minutes - b.minutes);
	return (
		<div className="rounded-md border border-border bg-surface-1 p-3">
			<div className="text-xs font-medium text-text-primary mb-2">
				Cycle time — {entries.length} KPI{entries.length === 1 ? "" : "s"} reached met
			</div>
			<ul className="space-y-1">
				{sorted.map((entry) => (
					<li key={entry.kpiId} className="flex items-center justify-between text-xs">
						<span className="text-text-secondary truncate">{entry.kpiId}</span>
						<span className="text-text-tertiary tabular-nums">{formatMinutes(entry.minutes)}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function RegressionList({ entries }: { entries: readonly RuntimeKpiRegressionEntry[] }): ReactElement {
	if (entries.length === 0) {
		return <ChartEmpty label="Regressions" reason="No KPI has flipped from met to missed." />;
	}
	return (
		<div className="rounded-md border border-status-red/30 bg-status-red/5 p-3">
			<div className="text-xs font-medium text-status-red mb-2">
				{entries.length} regression{entries.length === 1 ? "" : "s"}
			</div>
			<ul className="space-y-1">
				{entries.map((entry) => (
					<li key={`${entry.kpiId}-${entry.ts}`} className="flex items-center justify-between text-xs">
						<span className="text-text-secondary truncate">{entry.kpiId}</span>
						<span className="text-text-tertiary tabular-nums">{entry.ts.slice(0, 16).replace("T", " ")}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function ChartFrame({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
	return (
		<div className="rounded-md border border-border bg-surface-1 p-3">
			<div className="text-xs font-medium text-text-primary mb-2">{title}</div>
			<svg
				viewBox={`0 0 ${CHART_W} ${CHART_H}`}
				preserveAspectRatio="none"
				className="w-full"
				style={{ height: CHART_H }}
				role="img"
			>
				<line
					x1={PAD.left}
					y1={CHART_H - PAD.bottom}
					x2={CHART_W - PAD.right}
					y2={CHART_H - PAD.bottom}
					stroke="var(--color-border)"
				/>
				<line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={CHART_H - PAD.bottom} stroke="var(--color-border)" />
				{children}
			</svg>
		</div>
	);
}

function YAxisLabels({ max }: { max: number }): ReactElement {
	const step = max <= 4 ? 1 : Math.ceil(max / 4);
	const ticks: number[] = [];
	for (let v = 0; v <= max; v += step) ticks.push(v);
	if (ticks[ticks.length - 1] !== max) ticks.push(max);
	const yScale = scaleY(0, max);
	return (
		<g>
			{ticks.map((v) => (
				<text
					key={v}
					x={PAD.left - 4}
					y={yScale(v) + 3}
					textAnchor="end"
					fontSize={9}
					fill="var(--color-text-tertiary)"
				>
					{v}
				</text>
			))}
		</g>
	);
}

function ChartEmpty({ label, reason }: { label: string; reason: string }): ReactElement {
	return (
		<div className="rounded-md border border-border bg-surface-1 p-3">
			<div className="text-xs font-medium text-text-primary mb-1">{label}</div>
			<div className="text-xs text-text-tertiary">{reason}</div>
		</div>
	);
}

function scaleX(values: number[]): (v: number) => number {
	if (values.length === 0) return () => PAD.left;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const innerW = CHART_W - PAD.left - PAD.right;
	if (min === max) return () => PAD.left + innerW / 2;
	return (v) => PAD.left + ((v - min) / (max - min)) * innerW;
}

function scaleY(min: number, max: number): (v: number) => number {
	if (min === max) return () => CHART_H - PAD.bottom;
	const innerH = CHART_H - PAD.top - PAD.bottom;
	return (v) => CHART_H - PAD.bottom - ((v - min) / (max - min)) * innerH;
}

function formatMinutes(minutes: number): string {
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${hours.toFixed(1)}h`;
	const days = hours / 24;
	return `${days.toFixed(1)}d`;
}
