// Defines the typed TRPC boundary between the browser and the local runtime.
// Keep request and response contracts plus workspace-scoped procedures here,
// and delegate domain behavior to runtime-api.ts and lower-level services.
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
	RuntimeClineAccountBalanceResponse,
	RuntimeClineAccountOrganizationsResponse,
	RuntimeClineAccountProfileResponse,
	RuntimeClineAccountSwitchRequest,
	RuntimeClineAccountSwitchResponse,
	RuntimeClineAddProviderRequest,
	RuntimeClineAddProviderResponse,
	RuntimeClineDeviceAuthCompleteRequest,
	RuntimeClineDeviceAuthCompleteResponse,
	RuntimeClineDeviceAuthStartResponse,
	RuntimeClineKanbanAccessResponse,
	RuntimeClineMcpAuthStatusResponse,
	RuntimeClineMcpOAuthRequest,
	RuntimeClineMcpOAuthResponse,
	RuntimeClineMcpSettingsResponse,
	RuntimeClineMcpSettingsSaveRequest,
	RuntimeClineMcpSettingsSaveResponse,
	RuntimeClineOauthLoginRequest,
	RuntimeClineOauthLoginResponse,
	RuntimeClineProviderCatalogResponse,
	RuntimeClineProviderModelsRequest,
	RuntimeClineProviderModelsResponse,
	RuntimeClineProviderSettingsSaveRequest,
	RuntimeClineProviderSettingsSaveResponse,
	RuntimeClineUpdateProviderRequest,
	RuntimeClineUpdateProviderResponse,
	RuntimeCommandRunRequest,
	RuntimeCommandRunResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeFeaturebaseTokenResponse,
	RuntimeGitCheckoutRequest,
	RuntimeGitCheckoutResponse,
	RuntimeGitCommitDiffRequest,
	RuntimeGitCommitDiffResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitLogRequest,
	RuntimeGitLogResponse,
	RuntimeGitRefsResponse,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeHookIngestRequest,
	RuntimeHookIngestResponse,
	RuntimeOpenFileRequest,
	RuntimeOpenFileResponse,
	RuntimeProjectAddRequest,
	RuntimeProjectAddResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeProjectRemoveRequest,
	RuntimeProjectRemoveResponse,
	RuntimeProjectsResponse,
	RuntimeRunUpdateResponse,
	RuntimeShellSessionStartRequest,
	RuntimeShellSessionStartResponse,
	RuntimeSlashCommandsResponse,
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
	RuntimeTaskChatMessagesRequest,
	RuntimeTaskChatMessagesResponse,
	RuntimeTaskChatReloadRequest,
	RuntimeTaskChatReloadResponse,
	RuntimeTaskChatSendRequest,
	RuntimeTaskChatSendResponse,
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionStartRequest,
	RuntimeTaskSessionStartResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileSearchRequest,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateNotifyResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureRequest,
	RuntimeWorktreeEnsureResponse,
} from "../core/api-contract";
import {
	runtimeClineAccountBalanceResponseSchema,
	runtimeClineAccountOrganizationsResponseSchema,
	runtimeClineAccountProfileResponseSchema,
	runtimeClineAccountSwitchRequestSchema,
	runtimeClineAccountSwitchResponseSchema,
	runtimeClineAddProviderRequestSchema,
	runtimeClineAddProviderResponseSchema,
	runtimeClineDeviceAuthCompleteRequestSchema,
	runtimeClineDeviceAuthCompleteResponseSchema,
	runtimeClineDeviceAuthStartResponseSchema,
	runtimeClineKanbanAccessResponseSchema,
	runtimeClineMcpAuthStatusResponseSchema,
	runtimeClineMcpOAuthRequestSchema,
	runtimeClineMcpOAuthResponseSchema,
	runtimeClineMcpSettingsResponseSchema,
	runtimeClineMcpSettingsSaveRequestSchema,
	runtimeClineMcpSettingsSaveResponseSchema,
	runtimeClineOauthLoginRequestSchema,
	runtimeClineOauthLoginResponseSchema,
	runtimeClineProviderCatalogResponseSchema,
	runtimeClineProviderModelsRequestSchema,
	runtimeClineProviderModelsResponseSchema,
	runtimeClineProviderSettingsSaveRequestSchema,
	runtimeClineProviderSettingsSaveResponseSchema,
	runtimeClineUpdateProviderRequestSchema,
	runtimeClineUpdateProviderResponseSchema,
	runtimeCommandRunRequestSchema,
	runtimeCommandRunResponseSchema,
	runtimeConfigResponseSchema,
	runtimeConfigSaveRequestSchema,
	runtimeDebugResetAllStateResponseSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimeFeaturebaseTokenResponseSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeGitCheckoutResponseSchema,
	runtimeGitCommitDiffRequestSchema,
	runtimeGitCommitDiffResponseSchema,
	runtimeGitDiscardResponseSchema,
	runtimeGitLogRequestSchema,
	runtimeGitLogResponseSchema,
	runtimeGitRefsResponseSchema,
	runtimeGitSummaryResponseSchema,
	runtimeGitSyncActionSchema,
	runtimeGitSyncResponseSchema,
	runtimeHookIngestRequestSchema,
	runtimeHookIngestResponseSchema,
	runtimeKpiClearOverrideRequestSchema,
	runtimeKpiOkResponseSchema,
	runtimeKpiOverrideRequestSchema,
	runtimeKpiRecordReadingRequestSchema,
	runtimeKpiRecordSubReadingRequestSchema,
	runtimeKpiRollupRequestSchema,
	runtimeKpiRollupResponseSchema,
	runtimeKpiSnapshotRequestSchema,
	runtimeKpiSnapshotSchema,
	runtimeOpenFileRequestSchema,
	runtimeOpenFileResponseSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectAddResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeProjectRemoveResponseSchema,
	runtimeProjectsResponseSchema,
	runtimeRoadmapFileResponseSchema,
	runtimeRoadmapFileWriteRequestSchema,
	runtimeRoadmapImportRequestSchema,
	runtimeRoadmapMtimeResponseSchema,
	runtimeRoadmapStateResponseSchema,
	runtimeRoadmapStateWriteRequestSchema,
	runtimeRunUpdateResponseSchema,
	runtimeShellSessionStartRequestSchema,
	runtimeShellSessionStartResponseSchema,
	runtimeSlashCommandsResponseSchema,
	runtimeTaskChatAbortRequestSchema,
	runtimeTaskChatAbortResponseSchema,
	runtimeTaskChatCancelRequestSchema,
	runtimeTaskChatCancelResponseSchema,
	runtimeTaskChatMessagesRequestSchema,
	runtimeTaskChatMessagesResponseSchema,
	runtimeTaskChatReloadRequestSchema,
	runtimeTaskChatReloadResponseSchema,
	runtimeTaskChatSendRequestSchema,
	runtimeTaskChatSendResponseSchema,
	runtimeTaskSessionInputRequestSchema,
	runtimeTaskSessionInputResponseSchema,
	runtimeTaskSessionStartRequestSchema,
	runtimeTaskSessionStartResponseSchema,
	runtimeTaskSessionStopRequestSchema,
	runtimeTaskSessionStopResponseSchema,
	runtimeTaskSubKpisRequestSchema,
	runtimeTaskSubKpisResponseSchema,
	runtimeTaskWorkspaceInfoRequestSchema,
	runtimeTaskWorkspaceInfoResponseSchema,
	runtimeUpdateStatusResponseSchema,
	runtimeWorkspaceChangesRequestSchema,
	runtimeWorkspaceChangesResponseSchema,
	runtimeWorkspaceFileSearchRequestSchema,
	runtimeWorkspaceFileSearchResponseSchema,
	runtimeWorkspaceStateNotifyResponseSchema,
	runtimeWorkspaceStateResponseSchema,
	runtimeWorkspaceStateSaveRequestSchema,
	runtimeWorktreeDeleteRequestSchema,
	runtimeWorktreeDeleteResponseSchema,
	runtimeWorktreeEnsureRequestSchema,
	runtimeWorktreeEnsureResponseSchema,
	validationReviewOutcomeIoSchema,
} from "../core/api-contract";
import { experimentLogEntrySchema } from "../workspace/experiment-log-file.js";
import { loadProjectKpisForItem, loadSubKpisForTask } from "../workspace/kpi-roadmap-loader.js";
import { buildKpiSnapshot } from "../workspace/kpi-snapshot.js";
import {
	appendKpiReading,
	appendSubKpiReading,
	clearKpiOverride,
	readKpiStateFile,
	setKpiOverride,
} from "../workspace/kpi-state-file.js";
import {
	changelogEntryInputSchema as sharedMemoryChangelogEntryInputSchema,
	changelogEntrySchema as sharedMemoryChangelogEntrySchema,
} from "../workspace/shared-memory.js";
import { validationReportSchema } from "../workspace/validator.js";

export interface RuntimeTrpcWorkspaceScope {
	workspaceId: string;
	workspacePath: string;
}

export interface RuntimeTrpcContext {
	requestedWorkspaceId: string | null;
	workspaceScope: RuntimeTrpcWorkspaceScope | null;
	runtimeApi: {
		loadConfig: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeConfigResponse>;
		saveConfig: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeConfigSaveRequest,
		) => Promise<RuntimeConfigResponse>;
		saveClineProviderSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineProviderSettingsSaveRequest,
		) => Promise<RuntimeClineProviderSettingsSaveResponse>;
		addClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineAddProviderRequest,
		) => Promise<RuntimeClineAddProviderResponse>;
		updateClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineUpdateProviderRequest,
		) => Promise<RuntimeClineUpdateProviderResponse>;
		startTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStartRequest,
		) => Promise<RuntimeTaskSessionStartResponse>;
		stopTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStopRequest,
		) => Promise<RuntimeTaskSessionStopResponse>;
		sendTaskSessionInput: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionInputRequest,
		) => Promise<RuntimeTaskSessionInputResponse>;
		getTaskChatMessages: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatMessagesRequest,
		) => Promise<RuntimeTaskChatMessagesResponse>;
		getClineSlashCommands: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeSlashCommandsResponse>;
		sendTaskChatMessage: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatSendRequest,
		) => Promise<RuntimeTaskChatSendResponse>;
		reloadTaskChatSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatReloadRequest,
		) => Promise<RuntimeTaskChatReloadResponse>;
		abortTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatAbortRequest,
		) => Promise<RuntimeTaskChatAbortResponse>;
		cancelTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatCancelRequest,
		) => Promise<RuntimeTaskChatCancelResponse>;
		getClineProviderCatalog: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeClineProviderCatalogResponse>;
		getClineAccountProfile: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineAccountProfileResponse>;
		getClineKanbanAccess: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineKanbanAccessResponse>;
		getFeaturebaseToken: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeFeaturebaseTokenResponse>;
		getClineAccountBalance: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineAccountBalanceResponse>;
		getClineAccountOrganizations: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeClineAccountOrganizationsResponse>;
		switchClineAccount: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineAccountSwitchRequest,
		) => Promise<RuntimeClineAccountSwitchResponse>;
		getClineProviderModels: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineProviderModelsRequest,
		) => Promise<RuntimeClineProviderModelsResponse>;
		runClineProviderOAuthLogin: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineOauthLoginRequest,
		) => Promise<RuntimeClineOauthLoginResponse>;
		startClineDeviceAuth: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineDeviceAuthStartResponse>;
		completeClineDeviceAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineDeviceAuthCompleteRequest,
		) => Promise<RuntimeClineDeviceAuthCompleteResponse>;
		getClineMcpAuthStatuses: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineMcpAuthStatusResponse>;
		runClineMcpServerOAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineMcpOAuthRequest,
		) => Promise<RuntimeClineMcpOAuthResponse>;
		getClineMcpSettings: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineMcpSettingsResponse>;
		saveClineMcpSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineMcpSettingsSaveRequest,
		) => Promise<RuntimeClineMcpSettingsSaveResponse>;
		startShellSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeShellSessionStartRequest,
		) => Promise<RuntimeShellSessionStartResponse>;
		runCommand: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeCommandRunRequest,
		) => Promise<RuntimeCommandRunResponse>;
		resetAllState: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeDebugResetAllStateResponse>;
		openFile: (input: RuntimeOpenFileRequest) => Promise<RuntimeOpenFileResponse>;
		getUpdateStatus: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeUpdateStatusResponse>;
		runUpdateNow: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeRunUpdateResponse>;
	};
	workspaceApi: {
		loadGitSummary: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitSummaryResponse>;
		runGitSyncAction: (
			scope: RuntimeTrpcWorkspaceScope,
			input: { action: RuntimeGitSyncAction },
		) => Promise<RuntimeGitSyncResponse>;
		checkoutGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCheckoutRequest,
		) => Promise<RuntimeGitCheckoutResponse>;
		discardGitChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitDiscardResponse>;
		loadChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceChangesRequest,
		) => Promise<RuntimeWorkspaceChangesResponse>;
		ensureWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeEnsureRequest,
		) => Promise<RuntimeWorktreeEnsureResponse>;
		deleteWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeDeleteRequest,
		) => Promise<RuntimeWorktreeDeleteResponse>;
		loadTaskContext: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest,
		) => Promise<RuntimeTaskWorkspaceInfoResponse>;
		searchFiles: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceFileSearchRequest,
		) => Promise<RuntimeWorkspaceFileSearchResponse>;
		loadState: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateResponse>;
		notifyStateUpdated: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateNotifyResponse>;
		saveState: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceStateSaveRequest,
		) => Promise<RuntimeWorkspaceStateResponse>;
		loadWorkspaceChanges: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceChangesResponse>;
		loadGitLog: (scope: RuntimeTrpcWorkspaceScope, input: RuntimeGitLogRequest) => Promise<RuntimeGitLogResponse>;
		loadGitRefs: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitRefsResponse>;
		loadCommitDiff: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCommitDiffRequest,
		) => Promise<RuntimeGitCommitDiffResponse>;
	};
	projectsApi: {
		listProjects: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectsResponse>;
		addProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectAddRequest,
		) => Promise<RuntimeProjectAddResponse>;
		removeProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectRemoveRequest,
		) => Promise<RuntimeProjectRemoveResponse>;
		pickProjectDirectory: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectDirectoryPickerResponse>;
		listDirectoryContents: (
			preferredWorkspaceId: string | null,
			input: RuntimeDirectoryListRequest,
		) => Promise<RuntimeDirectoryListResponse>;
	};
	hooksApi: {
		ingest: (input: RuntimeHookIngestRequest) => Promise<RuntimeHookIngestResponse>;
	};
}

interface RuntimeTrpcContextWithWorkspaceScope extends RuntimeTrpcContext {
	workspaceScope: RuntimeTrpcWorkspaceScope;
}

function readConflictRevision(cause: unknown): number | null {
	if (!cause || typeof cause !== "object" || !("currentRevision" in cause)) {
		return null;
	}
	const revision = (cause as { currentRevision?: unknown }).currentRevision;
	if (typeof revision !== "number") {
		return null;
	}
	return Number.isFinite(revision) ? revision : null;
}

const t = initTRPC.context<RuntimeTrpcContext>().create({
	errorFormatter({ shape, error }) {
		const conflictRevision = error.code === "CONFLICT" ? readConflictRevision(error.cause) : null;
		return {
			...shape,
			data: {
				...shape.data,
				conflictRevision,
			},
		};
	},
});

const workspaceProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.requestedWorkspaceId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Missing workspace scope. Include x-kanban-workspace-id header or workspaceId query parameter.",
		});
	}
	if (!ctx.workspaceScope) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Unknown workspace ID: ${ctx.requestedWorkspaceId}`,
		});
	}
	return next({
		ctx: {
			...ctx,
			workspaceScope: ctx.workspaceScope,
		} satisfies RuntimeTrpcContextWithWorkspaceScope,
	});
});

const optionalTaskWorkspaceInfoRequestSchema = runtimeTaskWorkspaceInfoRequestSchema.nullable().optional();
const gitSyncActionInputSchema = z.object({
	action: runtimeGitSyncActionSchema,
});

export const runtimeAppRouter = t.router({
	runtime: t.router({
		getConfig: t.procedure.output(runtimeConfigResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.loadConfig(ctx.workspaceScope);
		}),
		saveConfig: t.procedure
			.input(runtimeConfigSaveRequestSchema)
			.output(runtimeConfigResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveConfig(ctx.workspaceScope, input);
			}),
		saveClineProviderSettings: t.procedure
			.input(runtimeClineProviderSettingsSaveRequestSchema)
			.output(runtimeClineProviderSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveClineProviderSettings(ctx.workspaceScope, input);
			}),
		addClineProvider: t.procedure
			.input(runtimeClineAddProviderRequestSchema)
			.output(runtimeClineAddProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.addClineProvider(ctx.workspaceScope, input);
			}),
		updateClineProvider: t.procedure
			.input(runtimeClineUpdateProviderRequestSchema)
			.output(runtimeClineUpdateProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.updateClineProvider(ctx.workspaceScope, input);
			}),
		startTaskSession: workspaceProcedure
			.input(runtimeTaskSessionStartRequestSchema)
			.output(runtimeTaskSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startTaskSession(ctx.workspaceScope, input);
			}),
		stopTaskSession: workspaceProcedure
			.input(runtimeTaskSessionStopRequestSchema)
			.output(runtimeTaskSessionStopResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.stopTaskSession(ctx.workspaceScope, input);
			}),
		sendTaskSessionInput: workspaceProcedure
			.input(runtimeTaskSessionInputRequestSchema)
			.output(runtimeTaskSessionInputResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendTaskSessionInput(ctx.workspaceScope, input);
			}),
		getTaskChatMessages: workspaceProcedure
			.input(runtimeTaskChatMessagesRequestSchema)
			.output(runtimeTaskChatMessagesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskChatMessages(ctx.workspaceScope, input);
			}),
		getClineSlashCommands: t.procedure.output(runtimeSlashCommandsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineSlashCommands(ctx.workspaceScope);
		}),
		reloadTaskChatSession: workspaceProcedure
			.input(runtimeTaskChatReloadRequestSchema)
			.output(runtimeTaskChatReloadResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.reloadTaskChatSession(ctx.workspaceScope, input);
			}),
		sendTaskChatMessage: workspaceProcedure
			.input(runtimeTaskChatSendRequestSchema)
			.output(runtimeTaskChatSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendTaskChatMessage(ctx.workspaceScope, input);
			}),
		abortTaskChatTurn: workspaceProcedure
			.input(runtimeTaskChatAbortRequestSchema)
			.output(runtimeTaskChatAbortResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.abortTaskChatTurn(ctx.workspaceScope, input);
			}),
		cancelTaskChatTurn: workspaceProcedure
			.input(runtimeTaskChatCancelRequestSchema)
			.output(runtimeTaskChatCancelResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.cancelTaskChatTurn(ctx.workspaceScope, input);
			}),
		getClineProviderCatalog: t.procedure.output(runtimeClineProviderCatalogResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineProviderCatalog(ctx.workspaceScope);
		}),
		getClineAccountProfile: t.procedure.output(runtimeClineAccountProfileResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineAccountProfile(ctx.workspaceScope);
		}),
		getClineKanbanAccess: t.procedure.output(runtimeClineKanbanAccessResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineKanbanAccess(ctx.workspaceScope);
		}),
		getFeaturebaseToken: t.procedure.output(runtimeFeaturebaseTokenResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getFeaturebaseToken(ctx.workspaceScope);
		}),
		getClineAccountBalance: t.procedure.output(runtimeClineAccountBalanceResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineAccountBalance(ctx.workspaceScope);
		}),
		getClineAccountOrganizations: t.procedure
			.output(runtimeClineAccountOrganizationsResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getClineAccountOrganizations(ctx.workspaceScope);
			}),
		switchClineAccount: t.procedure
			.input(runtimeClineAccountSwitchRequestSchema)
			.output(runtimeClineAccountSwitchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.switchClineAccount(ctx.workspaceScope, input);
			}),
		getClineProviderModels: t.procedure
			.input(runtimeClineProviderModelsRequestSchema)
			.output(runtimeClineProviderModelsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getClineProviderModels(ctx.workspaceScope, input);
			}),
		getClineMcpAuthStatuses: t.procedure.output(runtimeClineMcpAuthStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineMcpAuthStatuses(ctx.workspaceScope);
		}),
		runClineMcpServerOAuth: t.procedure
			.input(runtimeClineMcpOAuthRequestSchema)
			.output(runtimeClineMcpOAuthResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runClineMcpServerOAuth(ctx.workspaceScope, input);
			}),
		getClineMcpSettings: t.procedure.output(runtimeClineMcpSettingsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineMcpSettings(ctx.workspaceScope);
		}),
		saveClineMcpSettings: t.procedure
			.input(runtimeClineMcpSettingsSaveRequestSchema)
			.output(runtimeClineMcpSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveClineMcpSettings(ctx.workspaceScope, input);
			}),
		runClineProviderOAuthLogin: t.procedure
			.input(runtimeClineOauthLoginRequestSchema)
			.output(runtimeClineOauthLoginResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runClineProviderOAuthLogin(ctx.workspaceScope, input);
			}),
		startClineDeviceAuth: t.procedure.output(runtimeClineDeviceAuthStartResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.startClineDeviceAuth(ctx.workspaceScope);
		}),
		completeClineDeviceAuth: t.procedure
			.input(runtimeClineDeviceAuthCompleteRequestSchema)
			.output(runtimeClineDeviceAuthCompleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.completeClineDeviceAuth(ctx.workspaceScope, input);
			}),
		startShellSession: workspaceProcedure
			.input(runtimeShellSessionStartRequestSchema)
			.output(runtimeShellSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startShellSession(ctx.workspaceScope, input);
			}),
		readRoadmapFile: workspaceProcedure.output(runtimeRoadmapFileResponseSchema).query(async ({ ctx }) => {
			const { stat } = await import("node:fs/promises");
			const { readRoadmapFile, getRoadmapFilePath } = await import("../workspace/roadmap-file.js");
			const filePath = getRoadmapFilePath(ctx.workspaceScope.workspacePath);
			const result = await readRoadmapFile(ctx.workspaceScope.workspacePath);
			let mtime: number | null = null;
			try {
				const stats = await stat(filePath);
				mtime = stats.mtimeMs;
			} catch {
				// ENOENT or other error — mtime stays null
			}
			return { ...result, path: filePath, mtime };
		}),
		writeRoadmapFile: workspaceProcedure
			.input(runtimeRoadmapFileWriteRequestSchema)
			.output(runtimeRoadmapFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				const { stat } = await import("node:fs/promises");
				const { writeRoadmapFromItems, getRoadmapFilePath, serializeRoadmap } = await import(
					"../workspace/roadmap-file.js"
				);
				const filePath = getRoadmapFilePath(ctx.workspaceScope.workspacePath);
				await writeRoadmapFromItems(ctx.workspaceScope.workspacePath, input.items);
				const content = serializeRoadmap(input.items);
				let mtime: number | null = null;
				try {
					const stats = await stat(filePath);
					mtime = stats.mtimeMs;
				} catch {
					// Should not happen after a successful write, but handle gracefully
				}
				return { exists: true, content, path: filePath, mtime };
			}),
		importRoadmapText: workspaceProcedure
			.input(runtimeRoadmapImportRequestSchema)
			.output(z.object({ items: z.array(z.unknown()) }))
			.mutation(async ({ input }) => {
				const { parseImportedText } = await import("../workspace/roadmap-file.js");
				return { items: parseImportedText(input.content) };
			}),
		readRoadmapState: workspaceProcedure.output(runtimeRoadmapStateResponseSchema).query(async ({ ctx }) => {
			const { stat } = await import("node:fs/promises");
			const { readRoadmapStateFile, getRoadmapStateFilePath } = await import("../workspace/roadmap-state-file.js");
			const result = await readRoadmapStateFile(ctx.workspaceScope.workspacePath);
			let mtime: number | null = null;
			try {
				const stats = await stat(getRoadmapStateFilePath(ctx.workspaceScope.workspacePath));
				mtime = stats.mtimeMs;
			} catch {
				// ENOENT — file doesn't exist yet
			}
			return { ...result, mtime };
		}),
		checkRoadmapMtime: workspaceProcedure.output(runtimeRoadmapMtimeResponseSchema).query(async ({ ctx }) => {
			const { stat } = await import("node:fs/promises");
			const { getRoadmapFilePath } = await import("../workspace/roadmap-file.js");
			const { getRoadmapStateFilePath } = await import("../workspace/roadmap-state-file.js");

			let roadmapFileMtime: number | null = null;
			try {
				const stats = await stat(getRoadmapFilePath(ctx.workspaceScope.workspacePath));
				roadmapFileMtime = stats.mtimeMs;
			} catch {
				// ENOENT — file doesn't exist
			}

			let roadmapStateMtime: number | null = null;
			try {
				const stats = await stat(getRoadmapStateFilePath(ctx.workspaceScope.workspacePath));
				roadmapStateMtime = stats.mtimeMs;
			} catch {
				// ENOENT — file doesn't exist
			}

			return { roadmapFileMtime, roadmapStateMtime };
		}),
		writeRoadmapState: workspaceProcedure
			.input(runtimeRoadmapStateWriteRequestSchema)
			.output(runtimeRoadmapStateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				const { stat } = await import("node:fs/promises");
				const { writeRoadmapStateFile, getRoadmapStateFilePath } = await import(
					"../workspace/roadmap-state-file.js"
				);
				const next = { version: 1 as const, itemStates: input.itemStates };
				await writeRoadmapStateFile(ctx.workspaceScope.workspacePath, next);
				let mtime: number | null = null;
				try {
					const stats = await stat(getRoadmapStateFilePath(ctx.workspaceScope.workspacePath));
					mtime = stats.mtimeMs;
				} catch {
					// Should not happen after a successful write
				}
				return { ...next, mtime };
			}),
		readDeliverable: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(z.object({ markdown: z.string().nullable(), parsed: z.unknown().nullable() }))
			.query(async ({ ctx, input }) => {
				const { readDeliverableMd, parseDeliverableMd } = await import("../workspace/deliverable-file.js");
				const md = await readDeliverableMd(ctx.workspaceScope.workspacePath, input.taskId);
				if (!md) return { markdown: null, parsed: null };
				const parsed = parseDeliverableMd(md, input.taskId);
				return { markdown: md, parsed };
			}),
		readSpecFile: workspaceProcedure
			.input(z.object({ specName: z.string(), fileName: z.string() }))
			.output(z.object({ content: z.string().nullable() }))
			.query(async ({ ctx, input }) => {
				const { readFile } = await import("node:fs/promises");
				const { join } = await import("node:path");
				const filePath = join(ctx.workspaceScope.workspacePath, ".kanban", "specs", input.specName, input.fileName);
				try {
					const content = await readFile(filePath, "utf8");
					return { content };
				} catch {
					return { content: null };
				}
			}),

		// ── Roadmap templates ─────────────────────────────────────
		listRoadmapTemplates: workspaceProcedure
			.output(
				z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						description: z.string(),
						itemCount: z.number(),
					}),
				),
			)
			.query(async () => {
				const { getTemplateSummaries } = await import("../workspace/roadmap-templates.js");
				return getTemplateSummaries();
			}),
		applyRoadmapTemplate: workspaceProcedure
			.input(
				z.object({
					templateId: z.string(),
					projectName: z.string().optional(),
					force: z.boolean().optional(),
				}),
			)
			.output(z.object({ success: z.boolean(), error: z.string().optional() }))
			.mutation(async ({ ctx, input }) => {
				const { applyTemplate } = await import("../workspace/roadmap-templates.js");
				return await applyTemplate(
					ctx.workspaceScope.workspacePath,
					input.templateId,
					input.projectName,
					input.force,
				);
			}),

		// ── Shared memory (multi-agent coordination) ──────────────
		readSharedChangelog: workspaceProcedure
			.output(z.array(sharedMemoryChangelogEntrySchema))
			.query(async ({ ctx }) => {
				const { readChangelog } = await import("../workspace/shared-memory.js");
				return await readChangelog(ctx.workspaceScope.workspacePath);
			}),
		readSharedChangelogSince: workspaceProcedure
			.input(z.object({ since: z.string() }))
			.output(z.array(sharedMemoryChangelogEntrySchema))
			.query(async ({ ctx, input }) => {
				const { readChangelogSince } = await import("../workspace/shared-memory.js");
				return await readChangelogSince(ctx.workspaceScope.workspacePath, input.since);
			}),
		appendSharedChangelog: workspaceProcedure
			.input(sharedMemoryChangelogEntryInputSchema)
			.output(z.void())
			.mutation(async ({ ctx, input }) => {
				const { appendChangelog } = await import("../workspace/shared-memory.js");
				await appendChangelog(ctx.workspaceScope.workspacePath, input);
			}),
		readSharedInterfaces: workspaceProcedure.output(z.object({ content: z.string() })).query(async ({ ctx }) => {
			const { readInterfaces } = await import("../workspace/shared-memory.js");
			const content = await readInterfaces(ctx.workspaceScope.workspacePath);
			return { content };
		}),
		writeSharedInterfaces: workspaceProcedure
			.input(z.object({ content: z.string() }))
			.output(z.void())
			.mutation(async ({ ctx, input }) => {
				const { writeInterfaces } = await import("../workspace/shared-memory.js");
				await writeInterfaces(ctx.workspaceScope.workspacePath, input.content);
			}),
		readSharedDecisions: workspaceProcedure.output(z.object({ content: z.string() })).query(async ({ ctx }) => {
			const { readDecisions } = await import("../workspace/shared-memory.js");
			const content = await readDecisions(ctx.workspaceScope.workspacePath);
			return { content };
		}),
		writeSharedDecisions: workspaceProcedure
			.input(z.object({ content: z.string() }))
			.output(z.void())
			.mutation(async ({ ctx, input }) => {
				const { writeDecisions } = await import("../workspace/shared-memory.js");
				await writeDecisions(ctx.workspaceScope.workspacePath, input.content);
			}),

		// ── Deliverable validation ────────────────────────────────
		validateDeliverable: workspaceProcedure
			.input(
				z.object({
					taskId: z.string(),
					specSlug: z.string(),
					roadmapItemId: z.string(),
					ownedPaths: z.array(z.string()),
					specVersion: z.number().optional(),
				}),
			)
			.output(validationReportSchema)
			.mutation(async ({ ctx, input }) => {
				const { validateDeliverable, writeValidationReport } = await import("../workspace/validator.js");
				const { recordValidationResult } = await import("../workspace/validation-lifecycle.js");
				const { clearReviewFeedback } = await import("../workspace/review-feedback-file.js");
				const report = await validateDeliverable({
					workspacePath: ctx.workspaceScope.workspacePath,
					taskId: input.taskId,
					specSlug: input.specSlug,
					roadmapItemId: input.roadmapItemId,
					ownedPaths: input.ownedPaths,
					specVersion: input.specVersion,
				});
				await writeValidationReport(ctx.workspaceScope.workspacePath, input.taskId, report);
				// Record the validation in roadmap-state.json for PM notification
				await recordValidationResult(
					ctx.workspaceScope.workspacePath,
					input.roadmapItemId,
					input.taskId,
					report.result,
					report.validatedAt,
				);
				// A fresh validation means any prior reviewer feedback has been addressed
				// (or at least re-evaluated); drop the stale feedback file so the panel
				// doesn't show an outdated banner.
				await clearReviewFeedback(ctx.workspaceScope.workspacePath, input.taskId);
				return report;
			}),
		readValidationReport: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(z.object({ content: z.string().nullable(), report: validationReportSchema.nullable() }))
			.query(async ({ ctx, input }) => {
				const { readValidationReportFile } = await import("../workspace/validator.js");
				return await readValidationReportFile(ctx.workspaceScope.workspacePath, input.taskId);
			}),
		readExperimentLogs: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(z.array(experimentLogEntrySchema))
			.query(async ({ ctx, input }) => {
				const { readExperimentLogs } = await import("../workspace/experiment-log-file.js");
				return await readExperimentLogs(ctx.workspaceScope.workspacePath, input.taskId);
			}),
		clearReviewFeedback: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(z.void())
			.mutation(async ({ ctx, input }) => {
				const { clearReviewFeedback } = await import("../workspace/review-feedback-file.js");
				await clearReviewFeedback(ctx.workspaceScope.workspacePath, input.taskId);
			}),
		readReviewFeedback: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(
				z.object({
					content: z.string().nullable(),
					feedback: z
						.object({
							outcome: z.enum(["rejected", "escalated"]),
							roadmapItemId: z.string(),
							reviewedAt: z.string(),
							note: z.string().optional(),
						})
						.nullable(),
				}),
			)
			.query(async ({ ctx, input }) => {
				const { readReviewFeedback } = await import("../workspace/review-feedback-file.js");
				return await readReviewFeedback(ctx.workspaceScope.workspacePath, input.taskId);
			}),
		readExperimentLogFull: workspaceProcedure
			.input(z.object({ taskId: z.string(), name: z.string() }))
			.output(experimentLogEntrySchema.nullable())
			.query(async ({ ctx, input }) => {
				const { readExperimentLogFull } = await import("../workspace/experiment-log-file.js");
				return await readExperimentLogFull(ctx.workspaceScope.workspacePath, input.taskId, input.name);
			}),

		// ── Validation lifecycle (PM review flow) ─────────────────
		reviewValidation: workspaceProcedure
			.input(
				z.object({
					roadmapItemId: z.string(),
					taskId: z.string(),
					outcome: validationReviewOutcomeIoSchema,
					note: z.string().optional(),
				}),
			)
			.output(z.object({ updated: z.boolean() }))
			.mutation(async ({ ctx, input }) => {
				const { reviewValidation, maybeUpdateRoadmapStatus } = await import("../workspace/validation-lifecycle.js");
				await reviewValidation(
					ctx.workspaceScope.workspacePath,
					input.roadmapItemId,
					input.taskId,
					input.outcome,
					input.note,
				);
				// If accepted, check whether the roadmap item is fully done
				let updated = false;
				if (input.outcome === "accepted") {
					const boardState = await ctx.workspaceApi.loadState(ctx.workspaceScope);
					updated = await maybeUpdateRoadmapStatus(
						ctx.workspaceScope.workspacePath,
						input.roadmapItemId,
						boardState.board,
					);
				}
				return { updated };
			}),
		getTaskValidationHistory: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(
				z.array(
					z.object({
						reportResult: z.enum(["pass", "fail", "needs_review"]),
						validatedAt: z.string(),
						reviewed: z.boolean(),
						reviewOutcome: z.enum(["accepted", "rejected", "escalated"]).optional(),
						reviewNote: z.string().optional(),
						reviewedAt: z.string().optional(),
					}),
				),
			)
			.query(async ({ ctx, input }) => {
				const { getTaskValidationHistory } = await import("../workspace/validation-lifecycle.js");
				return await getTaskValidationHistory(ctx.workspaceScope.workspacePath, input.taskId);
			}),
		getPendingValidations: workspaceProcedure
			.output(
				z.array(
					z.object({
						roadmapItemId: z.string(),
						taskId: z.string(),
						reportResult: z.enum(["pass", "fail", "needs_review"]),
						validatedAt: z.string(),
					}),
				),
			)
			.query(async ({ ctx }) => {
				const { getPendingValidations } = await import("../workspace/validation-lifecycle.js");
				return await getPendingValidations(ctx.workspaceScope.workspacePath);
			}),
		getLatestValidationsPerTask: workspaceProcedure
			.output(
				z.array(
					z.object({
						roadmapItemId: z.string(),
						taskId: z.string(),
						reportResult: z.enum(["pass", "fail", "needs_review"]),
						validatedAt: z.string(),
						reviewed: z.boolean(),
						reviewOutcome: z.enum(["accepted", "rejected", "escalated"]).optional(),
					}),
				),
			)
			.query(async ({ ctx }) => {
				const { getLatestValidationsPerTask } = await import("../workspace/validation-lifecycle.js");
				return await getLatestValidationsPerTask(ctx.workspaceScope.workspacePath);
			}),

		// ── Project PR creation ──────────────────────────────────
		createProjectPr: workspaceProcedure
			.input(z.object({ taskId: z.string() }))
			.output(
				z.object({
					success: z.boolean(),
					prUrl: z.string().optional(),
					prNumber: z.number().optional(),
					error: z.string().optional(),
					validationTriggered: z.boolean().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const { areAllProjectSubtasksDone, getProjectSubtasks } = await import("../core/task-board-mutations.js");
				const { createProjectPr } = await import("../workspace/project-pr.js");

				// Load board state to find the project card
				const boardState = await ctx.workspaceApi.loadState(ctx.workspaceScope);
				const board = boardState.board;

				// Find the project card
				let projectCard: (typeof board.columns)[number]["cards"][number] | null = null;
				for (const column of board.columns) {
					const found = column.cards.find((c) => c.id === input.taskId);
					if (found) {
						projectCard = found;
						break;
					}
				}

				if (!projectCard) {
					return { success: false, error: `Task "${input.taskId}" not found.` };
				}
				if (projectCard.role !== "project_agent") {
					return { success: false, error: `Task "${input.taskId}" is not a project agent card.` };
				}
				if (!projectCard.specSlug) {
					return { success: false, error: `Project agent card "${input.taskId}" has no specSlug.` };
				}
				if (!projectCard.roadmapItemId) {
					return { success: false, error: `Project agent card "${input.taskId}" has no roadmapItemId.` };
				}

				// Check if all sub-tasks are done
				if (!areAllProjectSubtasksDone(board, input.taskId)) {
					return { success: false, error: "Not all sub-tasks are complete. Cannot create PR yet." };
				}

				// Resolve branch names
				const projectBranch = `project/${projectCard.specSlug}`;
				const baseBranch = projectCard.baseRef;
				const title = projectCard.title ?? `Project: ${projectCard.specSlug}`;

				// Gather completed sub-task titles
				const subtasks = getProjectSubtasks(board, input.taskId);
				const completedSubtaskTitles = subtasks.map((s) => s.title ?? s.id);

				// Create the PR
				const result = await createProjectPr({
					workspacePath: ctx.workspaceScope.workspacePath,
					projectBranch,
					baseBranch,
					title,
					specSlug: projectCard.specSlug,
					roadmapItemId: projectCard.roadmapItemId,
					taskId: input.taskId,
					completedSubtaskTitles,
				});

				// Trigger validation after successful PR creation
				let validationTriggered = false;
				if (result.success) {
					try {
						const { validateDeliverable, writeValidationReport } = await import("../workspace/validator.js");
						const { recordValidationResult } = await import("../workspace/validation-lifecycle.js");
						const report = await validateDeliverable({
							workspacePath: ctx.workspaceScope.workspacePath,
							taskId: input.taskId,
							specSlug: projectCard.specSlug,
							roadmapItemId: projectCard.roadmapItemId,
							ownedPaths: projectCard.ownedPaths ?? [],
						});
						await writeValidationReport(ctx.workspaceScope.workspacePath, input.taskId, report);
						await recordValidationResult(
							ctx.workspaceScope.workspacePath,
							projectCard.roadmapItemId,
							input.taskId,
							report.result,
							report.validatedAt,
						);
						validationTriggered = true;
					} catch {
						// Validation is best-effort after PR creation.
						// The PR was still created successfully.
					}
				}

				return {
					...result,
					validationTriggered,
				};
			}),

		runCommand: workspaceProcedure
			.input(runtimeCommandRunRequestSchema)
			.output(runtimeCommandRunResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runCommand(ctx.workspaceScope, input);
			}),
		resetAllState: t.procedure.output(runtimeDebugResetAllStateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.resetAllState(ctx.workspaceScope);
		}),
		openFile: t.procedure
			.input(runtimeOpenFileRequestSchema)
			.output(runtimeOpenFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.openFile(input);
			}),
		getUpdateStatus: t.procedure.output(runtimeUpdateStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getUpdateStatus(ctx.workspaceScope);
		}),
		runUpdateNow: t.procedure.output(runtimeRunUpdateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.runUpdateNow(ctx.workspaceScope);
		}),
		// -------------------------------------------------------------------
		// KPI tracking — see .plan/docs/kpi-tracking-design.md
		// -------------------------------------------------------------------
		getKpiSnapshot: workspaceProcedure
			.input(runtimeKpiSnapshotRequestSchema)
			.output(runtimeKpiSnapshotSchema)
			.query(async ({ ctx, input }) => {
				const workspaceRoot = ctx.workspaceScope.workspacePath;
				const { values: definitions, warnings } = await loadProjectKpisForItem(workspaceRoot, input.roadmapItemId);
				const state = await readKpiStateFile(workspaceRoot);
				const snapshot = buildKpiSnapshot({ itemId: input.roadmapItemId, definitions, state });
				return { ...snapshot, warnings };
			}),
		getTaskSubKpis: workspaceProcedure
			.input(runtimeTaskSubKpisRequestSchema)
			.output(runtimeTaskSubKpisResponseSchema)
			.query(async ({ ctx, input }) => {
				const workspaceRoot = ctx.workspaceScope.workspacePath;
				const { values: defs, warnings } = await loadSubKpisForTask(workspaceRoot, input.taskId);
				const state = await readKpiStateFile(workspaceRoot);
				const taskState = state.tasks[input.taskId];
				const subKpis = defs.map((def) => ({
					...def,
					readings: taskState?.subKpis[def.id]?.readings ?? [],
				}));
				return { taskId: input.taskId, subKpis, warnings };
			}),
		getKpiRollups: workspaceProcedure
			.input(runtimeKpiRollupRequestSchema)
			.output(runtimeKpiRollupResponseSchema)
			.query(async ({ ctx, input }) => {
				const workspaceRoot = ctx.workspaceScope.workspacePath;
				const state = await readKpiStateFile(workspaceRoot);
				const rollups = await Promise.all(
					input.roadmapItemIds.map(async (roadmapItemId) => {
						const { values: definitions } = await loadProjectKpisForItem(workspaceRoot, roadmapItemId);
						if (definitions.length === 0) {
							return { roadmapItemId, met: 0, total: 0, blockingIds: [] };
						}
						const snapshot = buildKpiSnapshot({ itemId: roadmapItemId, definitions, state });
						const met = snapshot.kpis.filter(
							(e) => e.evaluation.status === "met" || e.evaluation.status === "waived",
						).length;
						return {
							roadmapItemId,
							met,
							total: snapshot.kpis.length,
							blockingIds: snapshot.blockingKpis,
						};
					}),
				);
				return { rollups };
			}),
		recordKpiReading: workspaceProcedure
			.input(runtimeKpiRecordReadingRequestSchema)
			.output(runtimeKpiOkResponseSchema)
			.mutation(async ({ ctx, input }) => {
				await appendKpiReading(ctx.workspaceScope.workspacePath, {
					itemId: input.roadmapItemId,
					kpiId: input.kpiId,
					reading: input.reading,
				});
				return { ok: true };
			}),
		recordSubKpiReading: workspaceProcedure
			.input(runtimeKpiRecordSubReadingRequestSchema)
			.output(runtimeKpiOkResponseSchema)
			.mutation(async ({ ctx, input }) => {
				await appendSubKpiReading(ctx.workspaceScope.workspacePath, {
					taskId: input.taskId,
					subKpiId: input.subKpiId,
					reading: input.reading,
				});
				return { ok: true };
			}),
		setKpiOverride: workspaceProcedure
			.input(runtimeKpiOverrideRequestSchema)
			.output(runtimeKpiOkResponseSchema)
			.mutation(async ({ ctx, input }) => {
				await setKpiOverride(ctx.workspaceScope.workspacePath, {
					itemId: input.roadmapItemId,
					kpiId: input.kpiId,
					override: input.override,
				});
				return { ok: true };
			}),
		clearKpiOverride: workspaceProcedure
			.input(runtimeKpiClearOverrideRequestSchema)
			.output(runtimeKpiOkResponseSchema)
			.mutation(async ({ ctx, input }) => {
				await clearKpiOverride(ctx.workspaceScope.workspacePath, {
					itemId: input.roadmapItemId,
					kpiId: input.kpiId,
				});
				return { ok: true };
			}),
	}),
	workspace: t.router({
		getGitSummary: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitSummaryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitSummary(ctx.workspaceScope, input ?? null);
			}),
		runGitSyncAction: workspaceProcedure
			.input(gitSyncActionInputSchema)
			.output(runtimeGitSyncResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.runGitSyncAction(ctx.workspaceScope, input);
			}),
		checkoutGitBranch: workspaceProcedure
			.input(runtimeGitCheckoutRequestSchema)
			.output(runtimeGitCheckoutResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.checkoutGitBranch(ctx.workspaceScope, input);
			}),
		discardGitChanges: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitDiscardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.discardGitChanges(ctx.workspaceScope, input ?? null);
			}),
		getChanges: workspaceProcedure
			.input(runtimeWorkspaceChangesRequestSchema)
			.output(runtimeWorkspaceChangesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadChanges(ctx.workspaceScope, input);
			}),
		ensureWorktree: workspaceProcedure
			.input(runtimeWorktreeEnsureRequestSchema)
			.output(runtimeWorktreeEnsureResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.ensureWorktree(ctx.workspaceScope, input);
			}),
		deleteWorktree: workspaceProcedure
			.input(runtimeWorktreeDeleteRequestSchema)
			.output(runtimeWorktreeDeleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.deleteWorktree(ctx.workspaceScope, input);
			}),
		getTaskContext: workspaceProcedure
			.input(runtimeTaskWorkspaceInfoRequestSchema)
			.output(runtimeTaskWorkspaceInfoResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadTaskContext(ctx.workspaceScope, input);
			}),
		searchFiles: workspaceProcedure
			.input(runtimeWorkspaceFileSearchRequestSchema)
			.output(runtimeWorkspaceFileSearchResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.searchFiles(ctx.workspaceScope, input);
			}),
		getState: workspaceProcedure.output(runtimeWorkspaceStateResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadState(ctx.workspaceScope);
		}),
		notifyStateUpdated: workspaceProcedure
			.output(runtimeWorkspaceStateNotifyResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.workspaceApi.notifyStateUpdated(ctx.workspaceScope);
			}),
		saveState: workspaceProcedure
			.input(runtimeWorkspaceStateSaveRequestSchema)
			.output(runtimeWorkspaceStateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.saveState(ctx.workspaceScope, input);
			}),
		getWorkspaceChanges: workspaceProcedure.output(runtimeWorkspaceChangesResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadWorkspaceChanges(ctx.workspaceScope);
		}),
		getGitLog: workspaceProcedure
			.input(runtimeGitLogRequestSchema)
			.output(runtimeGitLogResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitLog(ctx.workspaceScope, input);
			}),
		getGitRefs: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitRefsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitRefs(ctx.workspaceScope, input ?? null);
			}),
		getCommitDiff: workspaceProcedure
			.input(runtimeGitCommitDiffRequestSchema)
			.output(runtimeGitCommitDiffResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadCommitDiff(ctx.workspaceScope, input);
			}),
	}),
	projects: t.router({
		list: t.procedure.output(runtimeProjectsResponseSchema).query(async ({ ctx }) => {
			return await ctx.projectsApi.listProjects(ctx.requestedWorkspaceId);
		}),
		add: t.procedure
			.input(runtimeProjectAddRequestSchema)
			.output(runtimeProjectAddResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.addProject(ctx.requestedWorkspaceId, input);
			}),
		remove: t.procedure
			.input(runtimeProjectRemoveRequestSchema)
			.output(runtimeProjectRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.removeProject(ctx.requestedWorkspaceId, input);
			}),
		pickDirectory: t.procedure.output(runtimeProjectDirectoryPickerResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.pickProjectDirectory(ctx.requestedWorkspaceId);
		}),
		listDirectoryContents: t.procedure
			.input(runtimeDirectoryListRequestSchema)
			.output(runtimeDirectoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.projectsApi.listDirectoryContents(ctx.requestedWorkspaceId, input);
			}),
	}),
	hooks: t.router({
		ingest: t.procedure
			.input(runtimeHookIngestRequestSchema)
			.output(runtimeHookIngestResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.hooksApi.ingest(input);
			}),
	}),
});

export type RuntimeAppRouter = typeof runtimeAppRouter;
export type RuntimeAppRouterInputs = inferRouterInputs<RuntimeAppRouter>;
export type RuntimeAppRouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
