import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type PendingValidation, usePendingValidations } from "@/runtime/use-pending-validations";

const getPendingValidationsMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			getPendingValidations: {
				query: getPendingValidationsMock,
			},
		},
	}),
}));

function HookHarness({
	workspaceId,
	refreshToken,
	onSnapshot,
}: {
	workspaceId: string | null;
	refreshToken: number | null | undefined;
	onSnapshot: (snapshot: Record<string, PendingValidation>) => void;
}): null {
	const snapshot = usePendingValidations(workspaceId, refreshToken);
	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);
	return null;
}

let container: HTMLDivElement;
let root: Root;

async function flushAll(): Promise<void> {
	// Allow promise microtasks to drain.
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	getPendingValidationsMock.mockReset();
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

describe("usePendingValidations", () => {
	it("returns an empty map when workspaceId is null", async () => {
		getPendingValidationsMock.mockResolvedValue([]);
		const onSnapshot = vi.fn();

		await act(async () => {
			root.render(<HookHarness workspaceId={null} refreshToken={null} onSnapshot={onSnapshot} />);
		});
		await flushAll();

		expect(getPendingValidationsMock).not.toHaveBeenCalled();
		expect(onSnapshot).toHaveBeenLastCalledWith({});
	});

	it("indexes results by taskId", async () => {
		getPendingValidationsMock.mockResolvedValue([
			{
				roadmapItemId: "roadmap_auth01",
				taskId: "t_login",
				reportResult: "needs_review",
				validatedAt: "2026-05-22T12:00:00.000Z",
			},
			{
				roadmapItemId: "roadmap_auth01",
				taskId: "t_signup",
				reportResult: "fail",
				validatedAt: "2026-05-22T13:00:00.000Z",
			},
		]);
		const snapshots: Array<Record<string, PendingValidation>> = [];

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId="ws-1"
					refreshToken={null}
					onSnapshot={(s) => {
						snapshots.push(s);
					}}
				/>,
			);
		});
		await flushAll();

		const final = snapshots[snapshots.length - 1] ?? {};
		expect(Object.keys(final)).toHaveLength(2);
		expect(final.t_login?.reportResult).toBe("needs_review");
		expect(final.t_signup?.reportResult).toBe("fail");
	});

	it("refetches when refreshToken changes", async () => {
		// First mount triggers an initial fetch + a refresh-token fetch (token=1).
		// Re-render with a new token triggers a third fetch.
		getPendingValidationsMock
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					roadmapItemId: "roadmap_x",
					taskId: "t_new",
					reportResult: "pass",
					validatedAt: "2026-05-23T00:00:00.000Z",
				},
			]);
		const onSnapshot = vi.fn();

		await act(async () => {
			root.render(<HookHarness workspaceId="ws-1" refreshToken={1} onSnapshot={onSnapshot} />);
		});
		await flushAll();

		await act(async () => {
			root.render(<HookHarness workspaceId="ws-1" refreshToken={2} onSnapshot={onSnapshot} />);
		});
		await flushAll();

		expect(getPendingValidationsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		const last = onSnapshot.mock.calls.at(-1)?.[0] ?? {};
		expect(last.t_new?.reportResult).toBe("pass");
	});

	it("falls back to empty map on query failure", async () => {
		getPendingValidationsMock.mockRejectedValue(new Error("boom"));
		const onSnapshot = vi.fn();

		await act(async () => {
			root.render(<HookHarness workspaceId="ws-1" refreshToken={null} onSnapshot={onSnapshot} />);
		});
		await flushAll();

		expect(onSnapshot).toHaveBeenLastCalledWith({});
	});

	it("clears the map when workspaceId changes to null", async () => {
		getPendingValidationsMock.mockResolvedValue([
			{
				roadmapItemId: "roadmap_x",
				taskId: "t_a",
				reportResult: "needs_review",
				validatedAt: "2026-05-23T00:00:00.000Z",
			},
		]);
		const onSnapshot = vi.fn();

		await act(async () => {
			root.render(<HookHarness workspaceId="ws-1" refreshToken={null} onSnapshot={onSnapshot} />);
		});
		await flushAll();

		await act(async () => {
			root.render(<HookHarness workspaceId={null} refreshToken={null} onSnapshot={onSnapshot} />);
		});
		await flushAll();

		expect(onSnapshot).toHaveBeenLastCalledWith({});
	});
});
