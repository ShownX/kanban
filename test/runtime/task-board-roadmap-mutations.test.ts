import { describe, expect, it } from "vitest";

import type { RuntimeBoardData, RuntimeRoadmapItem } from "../../src/core/api-contract";
import {
	addTaskToColumn,
	agentCreateSubtask,
	createTasksFromRoadmapItem,
	promoteAgentTasksToRoadmapItem,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
		roadmap: [],
		roadmapAnnotations: [],
	};
}

function createRoadmapItem(overrides: Partial<RuntimeRoadmapItem> = {}): RuntimeRoadmapItem {
	return {
		id: "rm_test1",
		title: "Test roadmap item",
		description: "A test item",
		status: "planned",
		tasks: [],
		linkedTaskIds: [],
		comments: [],
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

let idCounter = 0;
function nextId(): string {
	idCounter += 1;
	return `uuid-${idCounter.toString().padStart(5, "0")}`;
}

describe("createTasksFromRoadmapItem", () => {
	it("creates linked backlog cards and appends task refs to the roadmap item", () => {
		idCounter = 0;
		const board = createBoard();
		const item = createRoadmapItem();
		const result = createTasksFromRoadmapItem(
			board,
			item,
			[
				{ prompt: "Wire up signup form", baseRef: "main", title: "Signup form" },
				{ prompt: "Add session middleware", baseRef: "main", title: "Sessions" },
			],
			nextId,
			2000,
		);

		expect(result.createdTasks).toHaveLength(2);
		expect(result.createdTasks[0]?.roadmapItemId).toBe("rm_test1");
		expect(result.createdTasks[0]?.createdBy).toBe("human");
		expect(result.createdTasks[1]?.roadmapItemId).toBe("rm_test1");

		const backlog = result.board.columns.find((column) => column.id === "backlog");
		expect(backlog?.cards).toHaveLength(2);

		expect(result.updatedRoadmapItem.tasks).toHaveLength(2);
		expect(result.updatedRoadmapItem.tasks[0]?.title).toBe("Signup form");
		expect(result.updatedRoadmapItem.tasks[0]?.agentCreated).toBeUndefined();
		expect(result.updatedRoadmapItem.linkedTaskIds).toHaveLength(2);
		expect(result.updatedRoadmapItem.updatedAt).toBe(2000);
	});

	it("is a no-op for an empty drafts array", () => {
		const board = createBoard();
		const item = createRoadmapItem();
		const result = createTasksFromRoadmapItem(board, item, [], nextId, 3000);
		expect(result.createdTasks).toEqual([]);
		expect(result.board).toBe(board);
		expect(result.updatedRoadmapItem).toBe(item);
	});
});

describe("agentCreateSubtask", () => {
	it("refuses when parent task does not exist", () => {
		const result = agentCreateSubtask(
			createBoard(),
			"nonexistent",
			{
				prompt: "child",
				baseRef: "main",
				roadmapItemId: "rm_test1",
				agentCreatedCountForItem: 0,
				agentCreatedBudget: 10,
			},
			nextId,
			4000,
		);
		if ("reason" in result) {
			expect(result.reason).toBe("parent_not_found");
		} else {
			throw new Error("expected refusal");
		}
	});

	it("refuses when parent is not linked to the given roadmap item", () => {
		idCounter = 0;
		const parent = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ prompt: "parent", baseRef: "main", roadmapItemId: "rm_other", createdBy: "human" },
			nextId,
		);
		const result = agentCreateSubtask(
			parent.board,
			parent.task.id,
			{
				prompt: "child",
				baseRef: "main",
				roadmapItemId: "rm_test1",
				agentCreatedCountForItem: 0,
				agentCreatedBudget: 10,
			},
			nextId,
			5000,
		);
		if ("reason" in result) {
			expect(result.reason).toBe("parent_not_linked_to_roadmap_item");
		} else {
			throw new Error("expected refusal");
		}
	});

	it("refuses when parent is itself agent-created (depth=1 limit)", () => {
		idCounter = 0;
		const parent = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ prompt: "parent", baseRef: "main", roadmapItemId: "rm_test1", createdBy: "agent:grandparent" },
			nextId,
		);
		const result = agentCreateSubtask(
			parent.board,
			parent.task.id,
			{
				prompt: "child",
				baseRef: "main",
				roadmapItemId: "rm_test1",
				agentCreatedCountForItem: 0,
				agentCreatedBudget: 10,
			},
			nextId,
			6000,
		);
		if ("reason" in result) {
			expect(result.reason).toBe("parent_is_agent_created");
		} else {
			throw new Error("expected refusal");
		}
	});

	it("refuses when the per-item agent-created budget is reached", () => {
		idCounter = 0;
		const parent = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ prompt: "parent", baseRef: "main", roadmapItemId: "rm_test1", createdBy: "human" },
			nextId,
		);
		const result = agentCreateSubtask(
			parent.board,
			parent.task.id,
			{
				prompt: "child",
				baseRef: "main",
				roadmapItemId: "rm_test1",
				agentCreatedCountForItem: 10,
				agentCreatedBudget: 10,
			},
			nextId,
			7000,
		);
		if ("reason" in result) {
			expect(result.reason).toBe("budget_exceeded");
		} else {
			throw new Error("expected refusal");
		}
	});

	it("creates a child card with createdBy agent:<parentId> on success", () => {
		idCounter = 0;
		const parent = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ prompt: "parent", baseRef: "main", roadmapItemId: "rm_test1", createdBy: "human" },
			nextId,
		);
		const result = agentCreateSubtask(
			parent.board,
			parent.task.id,
			{
				prompt: "child subtask",
				baseRef: "main",
				roadmapItemId: "rm_test1",
				agentCreatedCountForItem: 0,
				agentCreatedBudget: 10,
			},
			nextId,
			8000,
		);
		if ("reason" in result) {
			throw new Error(`expected success, got ${result.reason}`);
		}
		expect(result.createdTask.roadmapItemId).toBe("rm_test1");
		expect(result.createdTask.createdBy).toBe(`agent:${parent.task.id}`);
		expect(result.createdTask.prompt).toBe("child subtask");

		const backlog = result.board.columns.find((column) => column.id === "backlog");
		expect(backlog?.cards).toHaveLength(1);
	});
});

describe("promoteAgentTasksToRoadmapItem", () => {
	it("appends matching tasks to the roadmap item with agentCreated: true", () => {
		idCounter = 0;
		const agentTask = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "agent task", baseRef: "main", roadmapItemId: "rm_test1", createdBy: "agent:parent1" },
			nextId,
		);
		const item = createRoadmapItem();
		const result = promoteAgentTasksToRoadmapItem(item, agentTask.board, [agentTask.task.id], 9000);

		expect(result.promotedTaskIds).toEqual([agentTask.task.id]);
		expect(result.skippedTaskIds).toEqual([]);
		expect(result.updatedRoadmapItem.tasks).toHaveLength(1);
		expect(result.updatedRoadmapItem.tasks[0]?.agentCreated).toBe(true);
		expect(result.updatedRoadmapItem.tasks[0]?.taskId).toBe(agentTask.task.id);
		expect(result.updatedRoadmapItem.linkedTaskIds).toContain(agentTask.task.id);
		expect(result.updatedRoadmapItem.updatedAt).toBe(9000);
	});

	it("skips task IDs that do not exist on the board", () => {
		const item = createRoadmapItem();
		const result = promoteAgentTasksToRoadmapItem(item, createBoard(), ["ghost1", "ghost2"], 10000);
		expect(result.promotedTaskIds).toEqual([]);
		expect(result.skippedTaskIds).toEqual(["ghost1", "ghost2"]);
		expect(result.updatedRoadmapItem).toBe(item);
	});

	it("is idempotent: skips task IDs already in the item's tasks[]", () => {
		idCounter = 0;
		const agentTask = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "agent task", baseRef: "main", roadmapItemId: "rm_test1", createdBy: "agent:parent1" },
			nextId,
		);
		const item = createRoadmapItem({
			tasks: [{ taskId: agentTask.task.id, title: "Already there", agentCreated: true }],
			linkedTaskIds: [agentTask.task.id],
		});
		const result = promoteAgentTasksToRoadmapItem(item, agentTask.board, [agentTask.task.id], 11000);
		expect(result.promotedTaskIds).toEqual([]);
		expect(result.skippedTaskIds).toEqual([agentTask.task.id]);
		expect(result.updatedRoadmapItem.tasks).toHaveLength(1);
	});
});
