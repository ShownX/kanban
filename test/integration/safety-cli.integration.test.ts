import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(
		process.execPath,
		["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/cli.ts"), ...args],
		{ encoding: "utf8", timeout: 60_000 },
	);
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("kanban safety CLI", () => {
	it("reports check-path success when the path is in scope", () => {
		const result = runCli([
			"safety",
			"check-path",
			"--path",
			"src/auth/login.ts",
			"--owned",
			"src/auth/",
			"--workspace",
			"/tmp/kanban-ws",
		]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout) as { ok: boolean; inScope: boolean };
		expect(payload.ok).toBe(true);
		expect(payload.inScope).toBe(true);
	});

	it("exits non-zero when check-path is out of scope", () => {
		const result = runCli([
			"safety",
			"check-path",
			"--path",
			"src/payment/checkout.ts",
			"--owned",
			"src/auth",
			"--workspace",
			"/tmp/kanban-ws",
		]);
		expect(result.status).toBe(1);
		const payload = JSON.parse(result.stdout) as { ok: boolean; reason: string };
		expect(payload.ok).toBe(false);
		expect(payload.reason).toBe("outside_owned_paths");
	});

	it("flags overlapping ownedPaths via check-overlap", () => {
		const claims = JSON.stringify([
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "auth-login", ownedPaths: ["src/auth/login.ts"] },
		]);
		const result = runCli(["safety", "check-overlap", "--claims-json", claims, "--workspace", "/tmp/kanban-ws"]);
		expect(result.status).toBe(1);
		const payload = JSON.parse(result.stdout) as {
			ok: boolean;
			conflictCount: number;
			conflicts: Array<{ message: string }>;
		};
		expect(payload.ok).toBe(false);
		expect(payload.conflictCount).toBe(1);
		expect(payload.conflicts[0]?.message).toContain("auth");
	});

	it("returns an empty conflict list when claims are disjoint", () => {
		const claims = JSON.stringify([
			{ id: "auth", ownedPaths: ["src/auth"] },
			{ id: "payment", ownedPaths: ["src/payment"] },
		]);
		const result = runCli(["safety", "check-overlap", "--claims-json", claims, "--workspace", "/tmp/kanban-ws"]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout) as { ok: boolean; conflictCount: number };
		expect(payload.ok).toBe(true);
		expect(payload.conflictCount).toBe(0);
	});

	it("dedup-paths collapses redundant descendants", () => {
		const result = runCli([
			"safety",
			"dedup-paths",
			"--owned",
			"src/auth,src/auth/login.ts,src/auth/session.ts",
			"--workspace",
			"/tmp/kanban-ws",
		]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout) as { after: string[] };
		expect(payload.after).toEqual(["src/auth"]);
	});

	it("verify-log returns ok on a missing log (vacuously valid)", () => {
		const result = runCli(["safety", "verify-log", "--log", "/tmp/kanban-nonexistent-log.jsonl"]);
		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout) as { ok: boolean; totalEntries: number };
		expect(payload.ok).toBe(true);
		expect(payload.totalEntries).toBe(0);
	});
});
