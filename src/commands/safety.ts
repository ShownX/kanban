import { resolve } from "node:path";

import type { Command } from "commander";

import { verifyActivityLog } from "../workspace/activity-log.js";
import {
	dedupOwnedPaths,
	findAllOwnedPathsConflicts,
	formatOwnedPathsConflict,
	type OwnedPathsClaim,
} from "../workspace/owned-paths-conflict.js";
import { checkPathInScope } from "../workspace/path-scope.js";

type JsonRecord = Record<string, unknown>;

function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

async function runSafety(handler: () => Promise<JsonRecord>): Promise<void> {
	try {
		const result = await handler();
		printJson(result);
		if (result.ok === false) {
			process.exitCode = 1;
		}
	} catch (error) {
		printJson({ ok: false, error: toErrorMessage(error) });
		process.exitCode = 1;
	}
}

function parseOwnedPathsOption(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

function parseClaimsJsonOption(value: string | undefined): OwnedPathsClaim[] {
	if (!value) {
		throw new Error("--claims-json is required.");
	}
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("--claims-json must be a JSON array of { id, ownedPaths } objects.");
	}
	return parsed.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new Error(`--claims-json entry ${index} is not an object.`);
		}
		const record = entry as { id?: unknown; ownedPaths?: unknown };
		if (typeof record.id !== "string" || record.id.trim().length === 0) {
			throw new Error(`--claims-json entry ${index} is missing a non-empty "id".`);
		}
		if (!Array.isArray(record.ownedPaths)) {
			throw new Error(`--claims-json entry ${index} is missing an "ownedPaths" array.`);
		}
		const ownedPaths = record.ownedPaths.map((p, j) => {
			if (typeof p !== "string") {
				throw new Error(`--claims-json entry ${index} ownedPaths[${j}] is not a string.`);
			}
			return p;
		});
		return { id: record.id, ownedPaths };
	});
}

export function registerSafetyCommand(program: Command): void {
	const safety = program.command("safety").description("Multi-agent cooperation safety checks.");

	safety
		.command("check-path")
		.description("Check whether a candidate path falls within an agent's ownedPaths scope.")
		.requiredOption("--path <path>", "Candidate path (workspace-relative).")
		.requiredOption(
			"--owned <comma-separated>",
			"Comma-separated workspace-relative ownedPaths declared by the agent.",
		)
		.option("--workspace <path>", "Workspace root. Defaults to the current directory.")
		.action(async (options: { path: string; owned: string; workspace?: string }) => {
			await runSafety(async () => {
				const workspacePath = resolve(options.workspace ?? process.cwd());
				const ownedPaths = parseOwnedPathsOption(options.owned);
				const violation = checkPathInScope({ workspacePath, ownedPaths }, options.path);
				if (!violation) {
					return { ok: true, workspacePath, candidatePath: options.path, inScope: true };
				}
				return {
					ok: false,
					workspacePath,
					candidatePath: violation.candidatePath,
					resolvedCandidate: violation.resolvedCandidate,
					reason: violation.reason,
					allowedRoots: violation.allowedRoots,
					inScope: false,
				};
			});
		});

	safety
		.command("check-overlap")
		.description("Detect overlapping ownedPaths across project agents.")
		.requiredOption(
			"--claims-json <json>",
			'JSON array of claims, e.g. \'[{"id":"auth","ownedPaths":["src/auth"]}]\'.',
		)
		.option("--workspace <path>", "Workspace root. Defaults to the current directory.")
		.action(async (options: { claimsJson: string; workspace?: string }) => {
			await runSafety(async () => {
				const workspacePath = resolve(options.workspace ?? process.cwd());
				const claims = parseClaimsJsonOption(options.claimsJson);
				const conflicts = findAllOwnedPathsConflicts(workspacePath, claims);
				return {
					ok: conflicts.length === 0,
					workspacePath,
					claimCount: claims.length,
					conflictCount: conflicts.length,
					conflicts: conflicts.map((conflict) => ({
						...conflict,
						message: formatOwnedPathsConflict(conflict),
					})),
				};
			});
		});

	safety
		.command("dedup-paths")
		.description("Print a minimal owned-paths set with redundant descendants removed.")
		.requiredOption("--owned <comma-separated>", "Comma-separated workspace-relative ownedPaths to dedup.")
		.option("--workspace <path>", "Workspace root. Defaults to the current directory.")
		.action(async (options: { owned: string; workspace?: string }) => {
			await runSafety(async () => {
				const workspacePath = resolve(options.workspace ?? process.cwd());
				const ownedPaths = parseOwnedPathsOption(options.owned);
				return {
					ok: true,
					workspacePath,
					before: ownedPaths,
					after: dedupOwnedPaths(workspacePath, ownedPaths),
				};
			});
		});

	safety
		.command("verify-log")
		.description("Verify the hash chain of a tamper-evident activity log.")
		.requiredOption("--log <path>", "Path to the JSONL activity log.")
		.action(async (options: { log: string }) => {
			await runSafety(async () => {
				const result = await verifyActivityLog(options.log);
				return { ...result };
			});
		});
}
