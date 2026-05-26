import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isValidIsoDate, parseRoadmapMarkdown, serializeRoadmap } from "../../src/workspace/roadmap-file";

describe("roadmap timeline metadata (start/end/milestone)", () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	let stderrOutput: string[];

	beforeEach(() => {
		stderrOutput = [];
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
			stderrOutput.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		});
	});

	afterEach(() => {
		stderrSpy.mockRestore();
	});

	describe("isValidIsoDate", () => {
		it("accepts well-formed calendar dates", () => {
			expect(isValidIsoDate("2026-05-08")).toBe(true);
			expect(isValidIsoDate("2000-01-01")).toBe(true);
			expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
			expect(isValidIsoDate("2026-12-31")).toBe(true);
		});

		it("rejects malformed or impossible dates", () => {
			expect(isValidIsoDate("")).toBe(false);
			expect(isValidIsoDate("2026-5-8")).toBe(false); // missing zero-pad
			expect(isValidIsoDate("2026/05/08")).toBe(false);
			expect(isValidIsoDate("not-a-date")).toBe(false);
			expect(isValidIsoDate("2026-13-01")).toBe(false); // month out of range
			expect(isValidIsoDate("2026-02-30")).toBe(false); // Feb 30
			expect(isValidIsoDate("2025-02-29")).toBe(false); // non-leap year
			expect(isValidIsoDate("2026-04-31")).toBe(false); // Apr 31
			expect(isValidIsoDate("2026-00-10")).toBe(false);
			expect(isValidIsoDate("2026-05-32")).toBe(false);
		});
	});

	describe("parseRoadmapMarkdown", () => {
		it("parses start, end, and milestone metadata when present", () => {
			const input = `# Roadmap

## Timeline item
**ID:** \`roadmap_tl01\`
**Status:** 🔵 Planned
**Start:** 2026-05-01
**End:** 2026-06-30
**Milestone:** true

Some description.

---
`;
			const items = parseRoadmapMarkdown(input);
			expect(items).toHaveLength(1);
			const item = items[0]!;
			expect(item.startDate).toBe("2026-05-01");
			expect(item.endDate).toBe("2026-06-30");
			expect(item.milestone).toBe(true);
			expect(item.description).toBe("Some description.");
			expect(stderrOutput).toEqual([]);
		});

		it("leaves fields undefined when metadata is absent", () => {
			const input = `# Roadmap

## Bare item
**ID:** \`roadmap_bare\`
**Status:** 🔵 Planned

---
`;
			const items = parseRoadmapMarkdown(input);
			expect(items).toHaveLength(1);
			const item = items[0]!;
			expect(item.startDate).toBeUndefined();
			expect(item.endDate).toBeUndefined();
			expect(item.milestone).toBeUndefined();
			expect(stderrOutput).toEqual([]);
		});

		it("accepts Milestone: false as an explicit non-milestone flag", () => {
			const input = `# Roadmap

## Not a milestone
**ID:** \`roadmap_nm\`
**Status:** 🔵 Planned
**Milestone:** false

---
`;
			const items = parseRoadmapMarkdown(input);
			expect(items[0]?.milestone).toBe(false);
			expect(stderrOutput).toEqual([]);
		});

		it("ignores malformed dates with a warning and leaves the field undefined", () => {
			const input = `# Roadmap

## Bad dates
**ID:** \`roadmap_bad\`
**Status:** 🔵 Planned
**Start:** not-a-date
**End:** 2026-02-30
**Milestone:** maybe

---
`;
			const items = parseRoadmapMarkdown(input);
			expect(items).toHaveLength(1);
			const item = items[0]!;
			expect(item.startDate).toBeUndefined();
			expect(item.endDate).toBeUndefined();
			expect(item.milestone).toBeUndefined();

			const warningText = stderrOutput.join("");
			expect(warningText).toContain("Ignoring malformed Start date");
			expect(warningText).toContain("not-a-date");
			expect(warningText).toContain("Ignoring malformed End date");
			expect(warningText).toContain("2026-02-30");
			expect(warningText).toContain("Ignoring malformed Milestone flag");
			expect(warningText).toContain("maybe");
		});

		it("only honors metadata before any ### subsection heading", () => {
			const input = `# Roadmap

## Sneaky metadata
**ID:** \`roadmap_sneak\`
**Status:** 🔵 Planned

### Requirements

**Start:** 2026-05-01

---
`;
			const items = parseRoadmapMarkdown(input);
			// Start inside Requirements should not be treated as metadata.
			expect(items[0]?.startDate).toBeUndefined();
			// V1 parser now folds requirements content into description
			expect(items[0]?.description).toContain("**Start:** 2026-05-01");
		});
	});

	describe("serializeRoadmap", () => {
		it("emits Launch Date column when endDate is set", () => {
			const ts = Date.now();
			const output = serializeRoadmap([
				{
					id: "roadmap_tl01",
					title: "Timeline item",
					description: "Body text.",
					status: "planned",
					startDate: "2026-05-01",
					endDate: "2026-06-30",
					milestone: true,
					openQuestions: [],
					tasks: [],
					linkedTaskIds: [],
					comments: [],
					createdAt: ts,
					updatedAt: ts,
				},
			]);
			// V2 table format puts endDate in the Launch Date column
			expect(output).toContain("2026-06-30");
			expect(output).toContain("Timeline item");
		});

		it("omits Launch Date when endDate is absent", () => {
			const ts = Date.now();
			const output = serializeRoadmap([
				{
					id: "roadmap_bare",
					title: "Bare item",
					description: "",
					status: "planned",
					milestone: false,
					openQuestions: [],
					tasks: [],
					linkedTaskIds: [],
					comments: [],
					createdAt: ts,
					updatedAt: ts,
				},
			]);
			// V2 table row should not have a date value
			expect(output).toContain("Bare item");
			expect(output).not.toContain("2026");
		});

		it("does not emit invalid dates even if they slip into the model", () => {
			const ts = Date.now();
			const output = serializeRoadmap([
				{
					id: "roadmap_tl02",
					title: "Item",
					description: "",
					status: "planned",
					startDate: "garbage",
					endDate: "2026-13-01",
					openQuestions: [],
					tasks: [],
					linkedTaskIds: [],
					comments: [],
					createdAt: ts,
					updatedAt: ts,
				},
			]);
			// Invalid dates should not appear in the Launch Date column
			expect(output).not.toContain("garbage");
			expect(output).not.toContain("2026-13-01");
		});
	});

	describe("round-trip", () => {
		it("preserves key fields across V2 table serialize/parse cycles", () => {
			const ts = Date.now();
			const original = [
				{
					id: "roadmap_tl03",
					title: "Timeline round-trip",
					description: "Ship a Gantt chart.",
					status: "in_progress" as const,
					owner: "agent:planner_01",
					endDate: "2026-07-15",
					goal: "Gantt chart renders correctly",
					specSlug: "timeline-round-trip",
					openQuestions: [],
					tasks: [],
					linkedTaskIds: [],
					comments: [],
					createdAt: ts,
					updatedAt: ts,
				},
			];

			const serialized = serializeRoadmap(original);
			const reparsed = parseRoadmapMarkdown(serialized);

			expect(reparsed).toHaveLength(1);
			const item = reparsed[0]!;
			expect(item.id).toBe("roadmap_tl03");
			expect(item.title).toBe("Timeline round-trip");
			expect(item.status).toBe("in_progress");
			// V2 table format preserves: POC (→ owner/poc), endDate (Launch Date), goal, specSlug
			expect(item.poc).toBe("agent:planner_01");
			expect(item.endDate).toBe("2026-07-15");
			expect(item.goal).toBe("Gantt chart renders correctly");
			expect(item.specSlug).toBe("timeline-round-trip");
			expect(item.description).toContain("Ship a Gantt chart.");
		});

		it("round-trips items without timeline metadata without inventing fields", () => {
			const ts = Date.now();
			const serialized = serializeRoadmap([
				{
					id: "roadmap_plain",
					title: "Plain item",
					description: "No dates.",
					status: "planned",
					openQuestions: [],
					tasks: [],
					linkedTaskIds: [],
					comments: [],
					createdAt: ts,
					updatedAt: ts,
				},
			]);
			const reparsed = parseRoadmapMarkdown(serialized);
			expect(reparsed[0]?.startDate).toBeUndefined();
			expect(reparsed[0]?.endDate).toBeUndefined();
			expect(reparsed[0]?.milestone).toBeUndefined();
		});
	});
});
