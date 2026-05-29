import { describe, expect, it } from "vitest";

import { CHAIN_HASH_GENESIS, chainHash, findChainBreak } from "../../../src/workspace/hash-chain";

describe("chainHash", () => {
	it("is deterministic", () => {
		const a = chainHash(CHAIN_HASH_GENESIS, { seq: 1, type: "x" });
		const b = chainHash(CHAIN_HASH_GENESIS, { seq: 1, type: "x" });
		expect(a).toBe(b);
	});

	it("is order-independent within a payload object", () => {
		const a = chainHash(CHAIN_HASH_GENESIS, { seq: 1, type: "x", scope: { kind: "p", id: "i" } });
		const b = chainHash(CHAIN_HASH_GENESIS, { scope: { id: "i", kind: "p" }, type: "x", seq: 1 });
		expect(a).toBe(b);
	});

	it("changes when prevHash changes", () => {
		const a = chainHash(CHAIN_HASH_GENESIS, { seq: 1 });
		const b = chainHash("different", { seq: 1 });
		expect(a).not.toBe(b);
	});

	it("changes when payload changes", () => {
		const a = chainHash(CHAIN_HASH_GENESIS, { seq: 1, value: 1 });
		const b = chainHash(CHAIN_HASH_GENESIS, { seq: 1, value: 2 });
		expect(a).not.toBe(b);
	});

	it("ignores undefined fields when canonicalizing", () => {
		const a = chainHash(CHAIN_HASH_GENESIS, { seq: 1 });
		const b = chainHash(CHAIN_HASH_GENESIS, { seq: 1, optional: undefined });
		expect(a).toBe(b);
	});
});

interface FakeEntry {
	seq: number;
	prevHash: string;
	chainHash: string;
}

function buildChain(entries: { seq: number }[]): FakeEntry[] {
	const result: FakeEntry[] = [];
	let prev = CHAIN_HASH_GENESIS;
	for (const entry of entries) {
		const partial = { seq: entry.seq, prevHash: prev };
		const h = chainHash(prev, partial);
		result.push({ ...partial, chainHash: h });
		prev = h;
	}
	return result;
}

describe("findChainBreak", () => {
	it("returns null for an intact chain", () => {
		const chain = buildChain([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
		expect(findChainBreak(chain)).toBeNull();
	});

	it("returns null for the empty chain", () => {
		expect(findChainBreak([])).toBeNull();
	});

	it("flags the first index whose prevHash doesn't link", () => {
		const chain = buildChain([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
		const tampered = [chain[0]!, { ...chain[1]!, prevHash: "tampered" }, chain[2]!];
		const broken = findChainBreak(tampered);
		expect(broken?.index).toBe(1);
		expect(broken?.reason).toContain("prevHash mismatch");
	});

	it("flags the first index whose chainHash is wrong", () => {
		const chain = buildChain([{ seq: 1 }, { seq: 2 }]);
		const tampered = [chain[0]!, { ...chain[1]!, chainHash: "wrong" }];
		const broken = findChainBreak(tampered);
		expect(broken?.index).toBe(1);
		expect(broken?.reason).toContain("chainHash mismatch");
	});
});
