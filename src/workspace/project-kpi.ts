/**
 * Project KPI types and store-agnostic helpers.
 *
 * See `.plan/docs/kpi-tracking-design.md` for the full design and
 * `.plan/docs/kpi-tracking-paper-trace.md` for the worked example
 * that motivated the aggregation policy + auto-from-validator deferral.
 *
 * Nothing in this file touches a filesystem or a runtime — it's pure
 * data shapes plus the engine that resolves a list of readings into
 * a status. Storage glue (read from ROADMAP.md, persist to
 * roadmap-state.json) lives in a follow-on module.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Target kinds — three are enough; see design §"Why three target kinds".
// ---------------------------------------------------------------------------

export const kpiBooleanTargetSchema = z.object({
	kind: z.literal("boolean"),
});

export const kpiNumericOpSchema = z.enum([">=", "<=", "==", "<", ">"]);

export const kpiNumericTargetSchema = z.object({
	kind: z.literal("numeric"),
	op: kpiNumericOpSchema,
	value: z.number(),
	unit: z.string().optional(),
});

export const kpiRubricTargetSchema = z.object({
	kind: z.literal("rubric"),
	/** Levels in order from worst to best. */
	levels: z.array(z.string()).min(2),
	minimum: z.string(),
});

export const kpiTargetSchema = z.discriminatedUnion("kind", [
	kpiBooleanTargetSchema,
	kpiNumericTargetSchema,
	kpiRubricTargetSchema,
]);

export type KpiBooleanTarget = z.infer<typeof kpiBooleanTargetSchema>;
export type KpiNumericTarget = z.infer<typeof kpiNumericTargetSchema>;
export type KpiRubricTarget = z.infer<typeof kpiRubricTargetSchema>;
export type KpiTarget = z.infer<typeof kpiTargetSchema>;

// ---------------------------------------------------------------------------
// Acceptance, status, aggregate
// ---------------------------------------------------------------------------

export const kpiAcceptanceSchema = z.enum(["manual", "auto-from-task", "auto-from-validator"]);
export type KpiAcceptance = z.infer<typeof kpiAcceptanceSchema>;

export const kpiStatusSchema = z.enum(["open", "met", "missed", "waived"]);
export type KpiStatus = z.infer<typeof kpiStatusSchema>;

/**
 * How readings combine when more than one is recorded against a KPI.
 * Default `latest` is right for booleans and most numerics; `sum` /
 * `min` / `max` / `all-must-meet` cover the cases where latest-wins
 * is silently wrong.
 */
export const kpiAggregateSchema = z.enum(["latest", "sum", "min", "max", "all-must-meet"]);
export type KpiAggregate = z.infer<typeof kpiAggregateSchema>;

// ---------------------------------------------------------------------------
// Readings — the shape of a single measurement attached to a KPI / sub-KPI.
// ---------------------------------------------------------------------------

export const kpiReadingSourceSchema = z.enum(["task", "validator", "manual"]);
export type KpiReadingSource = z.infer<typeof kpiReadingSourceSchema>;

export const kpiReadingSchema = z.object({
	recordedAt: z.string(),
	source: kpiReadingSourceSchema,
	taskId: z.string().optional(),
	validatorCheck: z.string().optional(),
	experimentLog: z.string().optional(),
	booleanValue: z.boolean().optional(),
	numericValue: z.number().optional(),
	rubricValue: z.string().optional(),
	note: z.string().optional(),
});
export type KpiReading = z.infer<typeof kpiReadingSchema>;

// ---------------------------------------------------------------------------
// Project KPI (on a roadmap item) and sub-KPI (on a task).
// ---------------------------------------------------------------------------

export const kpiOverrideSchema = z.object({
	status: kpiStatusSchema,
	reason: z.string(),
	reviewer: z.string(),
	decidedAt: z.string(),
});
export type KpiOverride = z.infer<typeof kpiOverrideSchema>;

export const projectKpiSchema = z.object({
	id: z.string(),
	label: z.string(),
	description: z.string().optional(),
	target: kpiTargetSchema,
	acceptance: kpiAcceptanceSchema.default("manual"),
	aggregate: kpiAggregateSchema.default("latest"),
	readings: z.array(kpiReadingSchema).default([]),
	override: kpiOverrideSchema.optional(),
});
export type ProjectKpi = z.infer<typeof projectKpiSchema>;

export const taskSubKpiSchema = z.object({
	id: z.string(),
	parentKpiId: z.string().optional(),
	label: z.string(),
	description: z.string().optional(),
	target: kpiTargetSchema,
	readings: z.array(kpiReadingSchema).default([]),
});
export type TaskSubKpi = z.infer<typeof taskSubKpiSchema>;
