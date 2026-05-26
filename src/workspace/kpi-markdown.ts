/**
 * KPI markdown round-trip.
 *
 * The roadmap markdown is the committed source of truth for KPI
 * **definitions** (label, target, acceptance, aggregate). Readings,
 * status, and overrides live in `.kanban/kpi-state.json`. This module
 * handles only the definition side.
 *
 * Format:
 *
 *     ### KPIs
 *     - id: p99_latency
 *       label: p99 checkout latency
 *       target: numeric op="<=" value=200 unit="ms"
 *       acceptance: auto-from-task
 *       aggregate: latest
 *     - id: rollback_runbook
 *       label: Rollback runbook published
 *       target: boolean
 *
 * Pure functions: parse a markdown string → `ProjectKpi[]`; serialize
 * `ProjectKpi[]` → markdown string. Round-trip safe for the fields the
 * format covers; unknown lines under a `- id:` block are preserved as
 * a `description` continuation so planners can keep notes.
 */

import {
	type KpiAcceptance,
	type KpiAggregate,
	type KpiTarget,
	type ProjectKpi,
	projectKpiSchema,
} from "./project-kpi.js";

const SECTION_HEADER = "### KPIs";
const ITEM_PREFIX = "- ";
const FIELD_INDENT = "  ";

interface RawItem {
	lines: string[];
}

export interface ParseKpiMarkdownResult {
	kpis: ProjectKpi[];
	warnings: string[];
}

/**
 * Pull KPI definitions out of a `### KPIs` section in the given
 * markdown. Returns an empty list when the section is absent (the
 * common case for legacy roadmap items).
 */
export function parseKpiMarkdownSection(markdown: string): ParseKpiMarkdownResult {
	const sectionBody = extractSectionBody(markdown);
	if (sectionBody === null) return { kpis: [], warnings: [] };
	const rawItems = splitIntoItems(sectionBody);
	const kpis: ProjectKpi[] = [];
	const warnings: string[] = [];
	for (const raw of rawItems) {
		const result = parseRawItem(raw);
		if (result.kind === "ok") {
			kpis.push(result.kpi);
		} else {
			warnings.push(result.message);
		}
	}
	return { kpis, warnings };
}

/**
 * Render a list of KPIs as a `### KPIs` section. Returns an empty
 * string for an empty list so callers can skip emitting the header.
 */
export function serializeKpisToMarkdown(kpis: readonly ProjectKpi[]): string {
	if (kpis.length === 0) return "";
	const lines: string[] = [SECTION_HEADER];
	for (const kpi of kpis) {
		lines.push(`${ITEM_PREFIX}id: ${kpi.id}`);
		lines.push(`${FIELD_INDENT}label: ${kpi.label}`);
		lines.push(`${FIELD_INDENT}target: ${serializeTarget(kpi.target)}`);
		if (kpi.acceptance !== "manual") {
			lines.push(`${FIELD_INDENT}acceptance: ${kpi.acceptance}`);
		}
		if (kpi.aggregate !== "latest") {
			lines.push(`${FIELD_INDENT}aggregate: ${kpi.aggregate}`);
		}
		if (kpi.description) {
			lines.push(`${FIELD_INDENT}description: ${kpi.description}`);
		}
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parsing internals
// ---------------------------------------------------------------------------

function extractSectionBody(markdown: string): string | null {
	const lines = markdown.split(/\r?\n/);
	let start = -1;
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i]!.trim() === SECTION_HEADER) {
			start = i + 1;
			break;
		}
	}
	if (start === -1) return null;
	let end = lines.length;
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (/^#{1,3} /.test(line)) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

function splitIntoItems(body: string): RawItem[] {
	const lines = body.split(/\r?\n/);
	const items: RawItem[] = [];
	let current: RawItem | null = null;
	for (const line of lines) {
		if (line.startsWith(ITEM_PREFIX)) {
			if (current) items.push(current);
			current = { lines: [line] };
		} else if (current && line.startsWith(FIELD_INDENT)) {
			current.lines.push(line);
		} else if (line.trim() === "") {
			// blank line — keep as a separator within a current item if any
			if (current) current.lines.push(line);
		}
		// Lines that aren't indented and aren't `- ` items end the
		// implicit grouping; we ignore them (defensive against stray
		// markdown the planner inserted).
	}
	if (current) items.push(current);
	return items;
}

interface ParsedFields {
	id?: string;
	label?: string;
	target?: KpiTarget;
	acceptance?: KpiAcceptance;
	aggregate?: KpiAggregate;
	description?: string;
}

function parseRawItem(raw: RawItem): { kind: "ok"; kpi: ProjectKpi } | { kind: "err"; message: string } {
	const fields: ParsedFields = {};
	for (const rawLine of raw.lines) {
		const line = rawLine.trim();
		if (line === "") continue;
		const stripped = line.startsWith(ITEM_PREFIX) ? line.slice(ITEM_PREFIX.length) : line;
		const colonIdx = stripped.indexOf(":");
		if (colonIdx === -1) continue;
		const key = stripped.slice(0, colonIdx).trim();
		const value = stripped.slice(colonIdx + 1).trim();
		switch (key) {
			case "id":
				fields.id = value;
				break;
			case "label":
				fields.label = value;
				break;
			case "target": {
				const target = parseTarget(value);
				if (target.kind === "err") return target;
				fields.target = target.target;
				break;
			}
			case "acceptance":
				if (value === "manual" || value === "auto-from-task" || value === "auto-from-validator") {
					fields.acceptance = value;
				} else {
					return { kind: "err", message: `Unknown acceptance "${value}".` };
				}
				break;
			case "aggregate":
				if (
					value === "latest" ||
					value === "sum" ||
					value === "min" ||
					value === "max" ||
					value === "all-must-meet"
				) {
					fields.aggregate = value;
				} else {
					return { kind: "err", message: `Unknown aggregate "${value}".` };
				}
				break;
			case "description":
				fields.description = value;
				break;
			default:
				// Unknown keys are tolerated — planners can keep notes.
				break;
		}
	}
	if (!fields.id) return { kind: "err", message: "KPI item is missing id." };
	if (!fields.label) return { kind: "err", message: `KPI "${fields.id}" is missing label.` };
	if (!fields.target) return { kind: "err", message: `KPI "${fields.id}" is missing target.` };
	const candidate = {
		id: fields.id,
		label: fields.label,
		target: fields.target,
		acceptance: fields.acceptance ?? "manual",
		aggregate: fields.aggregate ?? "latest",
		description: fields.description,
		readings: [],
	};
	const parsed = projectKpiSchema.safeParse(candidate);
	if (!parsed.success) {
		return { kind: "err", message: `KPI "${fields.id}" failed validation: ${parsed.error.message}` };
	}
	return { kind: "ok", kpi: parsed.data };
}

function parseTarget(value: string): { kind: "ok"; target: KpiTarget } | { kind: "err"; message: string } {
	const tokens = tokenizeTarget(value);
	if (tokens.length === 0) return { kind: "err", message: "Empty target." };
	const head = tokens[0]!;
	if (head === "boolean") {
		return { kind: "ok", target: { kind: "boolean" } };
	}
	if (head === "numeric") {
		const params = parseKeyValueTokens(tokens.slice(1));
		const op = params.get("op");
		const valueRaw = params.get("value");
		if (op !== ">=" && op !== "<=" && op !== "==" && op !== "<" && op !== ">") {
			return { kind: "err", message: `Numeric target needs op (one of >= <= == < >); got "${op ?? ""}".` };
		}
		if (valueRaw === undefined) {
			return { kind: "err", message: "Numeric target needs value=…" };
		}
		const numeric = Number.parseFloat(valueRaw);
		if (Number.isNaN(numeric)) {
			return { kind: "err", message: `Numeric target value "${valueRaw}" is not a number.` };
		}
		const target: KpiTarget = { kind: "numeric", op, value: numeric };
		const unit = params.get("unit");
		if (unit !== undefined) target.unit = unit;
		return { kind: "ok", target };
	}
	if (head === "rubric") {
		const params = parseKeyValueTokens(tokens.slice(1));
		const levelsRaw = params.get("levels");
		const minimum = params.get("minimum");
		if (!levelsRaw) return { kind: "err", message: "Rubric target needs levels=a|b|c" };
		if (!minimum) return { kind: "err", message: "Rubric target needs minimum=…" };
		const levels = levelsRaw
			.split("|")
			.map((s) => s.trim())
			.filter(Boolean);
		if (levels.length < 2) return { kind: "err", message: "Rubric target needs at least 2 levels." };
		return { kind: "ok", target: { kind: "rubric", levels, minimum } };
	}
	return { kind: "err", message: `Unknown target kind "${head}".` };
}

function tokenizeTarget(value: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < value.length; i += 1) {
		const ch = value[i]!;
		if (ch === '"') {
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && /\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current) tokens.push(current);
	return tokens;
}

function parseKeyValueTokens(tokens: readonly string[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const token of tokens) {
		const eqIdx = token.indexOf("=");
		if (eqIdx === -1) continue;
		map.set(token.slice(0, eqIdx).trim(), token.slice(eqIdx + 1).trim());
	}
	return map;
}

function serializeTarget(target: KpiTarget): string {
	switch (target.kind) {
		case "boolean":
			return "boolean";
		case "numeric": {
			const parts = [`numeric`, `op="${target.op}"`, `value=${target.value}`];
			if (target.unit !== undefined) parts.push(`unit="${target.unit}"`);
			return parts.join(" ");
		}
		case "rubric":
			return `rubric levels="${target.levels.join("|")}" minimum="${target.minimum}"`;
	}
}
