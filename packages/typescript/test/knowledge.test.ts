import { describe, expect, it } from "vitest";

import { ProbaDeckError } from "../src/errors.js";
import { canonicalizeKnowledge, combineWeight } from "../src/knowledge/canonicalize.js";
import {
  createInitialKnowledge,
  fixedCell,
  getKnowledgeCell,
  poolCell,
  type KnowledgeHypothesis,
  type KnowledgeState,
  type UniformPool,
} from "../src/knowledge/state.js";
import {
  conditionKnowledgeExact,
  conditionKnowledgeTarget,
  drawKnowledge,
  insertKnownKnowledge,
  mixKnowledgeStates,
  moveKnowledgeByIndices,
  moveKnowledgeByIndicesOrdered,
  relocateKnownInstances,
  removeKnownInstancesFromZone,
  revealShuffleKnowledge,
  shuffleKnowledge,
} from "../src/knowledge/transitions.js";
import { fraction } from "../src/math/fraction.js";
import { asInternalDeck } from "../src/model/state.js";
import { createDeck } from "../src/operations/reducer.js";

function hypothesis(
  active: KnowledgeHypothesis["active"],
  drawn: KnowledgeHypothesis["drawn"] = [],
  pools: readonly UniformPool[] = [],
  numerator = 1,
  denominator = 1,
): KnowledgeHypothesis {
  return Object.freeze({
    weight: fraction(numerator, denominator),
    active: Object.freeze(active),
    drawn: Object.freeze(drawn),
    pools: new Map(pools.map((component) => [component.poolId, component])),
  });
}

function state(...hypotheses: readonly KnowledgeHypothesis[]): KnowledgeState {
  return Object.freeze({ hypotheses: Object.freeze(hypotheses) });
}

function pool(poolId: string, ...candidates: readonly string[]): UniformPool {
  return Object.freeze({ poolId, candidates: Object.freeze(candidates) });
}

describe("knowledge canonicalization", () => {
  it("normalizes singleton pools, IDs, ordering, duplicates, and weights", () => {
    const first = hypothesis(
      [poolCell("z"), poolCell("a")],
      [poolCell("z")],
      [pool("z", "b", "a"), pool("a", "c")],
      1,
      4,
    );
    const equivalent = hypothesis(
      [poolCell("other"), fixedCell("c")],
      [poolCell("other")],
      [pool("other", "a", "b")],
      3,
      4,
    );
    const canonical = canonicalizeKnowledge([first, equivalent], 10);

    expect(canonical.hypotheses).toHaveLength(1);
    expect(canonical.hypotheses[0]?.weight).toEqual({ numerator: 1n, denominator: 1n });
    expect(canonical.hypotheses[0]?.active[1]).toEqual(fixedCell("c"));
    expect(canonical.hypotheses[0]?.pools.get("pool-1")?.candidates).toEqual(["a", "b"]);
    expect(combineWeight(first, 0, 2).weight).toEqual({ numerator: 0n, denominator: 1n });
    expect(combineWeight(first, 2, 3).weight).toEqual({ numerator: 2n, denominator: 12n });
  });

  it("rejects malformed, empty, and over-limit hypothesis collections", () => {
    const malformed: readonly KnowledgeHypothesis[] = [
      hypothesis([fixedCell("a"), fixedCell("a")]),
      hypothesis([poolCell("p")], [], [pool("p", "a", "b")]),
      hypothesis([poolCell("p"), poolCell("p")], [], [pool("p", "a", "a")]),
      hypothesis([fixedCell("a"), poolCell("p")], [], [pool("p", "a")]),
      hypothesis([poolCell("missing")]),
      hypothesis([fixedCell("a"), poolCell("p"), poolCell("p")], [], [pool("p", "a", "b")]),
    ];
    for (const bad of malformed) {
      expect(() => canonicalizeKnowledge([bad], 10)).toThrowError(Error);
    }
    expect(() => canonicalizeKnowledge([], 10)).toThrowError(ProbaDeckError);
    expect(() => canonicalizeKnowledge([hypothesis([fixedCell("a")], [], [], 0)], 10)).toThrowError(
      ProbaDeckError,
    );
    expect(() =>
      canonicalizeKnowledge(
        [hypothesis([fixedCell("a")], [], [], 1, 2), hypothesis([fixedCell("b")], [], [], 1, 2)],
        1,
      ),
    ).toThrowError(expect.objectContaining({ code: "INFERENCE_LIMIT_EXCEEDED" }));
    expect(
      canonicalizeKnowledge(
        [
          hypothesis(
            [poolCell("z"), poolCell("z"), poolCell("a"), poolCell("a")],
            [],
            [pool("z", "d", "c"), pool("a", "b", "a")],
          ),
        ],
        10,
      ).hypotheses[0]?.pools.size,
    ).toBe(2);
  });

  it("validates state access and public deck branding", () => {
    const initial = createInitialKnowledge(["a"]);
    expect(getKnowledgeCell(initial.hypotheses[0] ?? hypothesis([]), "active", 0)).toEqual(
      fixedCell("a"),
    );
    expect(() =>
      getKnowledgeCell(initial.hypotheses[0] ?? hypothesis([]), "drawn", 0),
    ).toThrowError(RangeError);
    expect(() =>
      createDeck({ cards: ["a"], config: { cardKey: (card) => card }, maxHypotheses: 0 }),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      asInternalDeck({ revision: 0, length: 0, drawnCount: 0, maxHypotheses: 1 }),
    ).toThrowError(ProbaDeckError);
  });
});

describe("knowledge transitions", () => {
  it("conditions fixed and pooled active/drawn locations", () => {
    const fixed = createInitialKnowledge(["a", "b"]);
    expect(conditionKnowledgeExact(fixed, "active", 0, "a", 10).hypotheses).toHaveLength(1);
    expect(() => conditionKnowledgeExact(fixed, "active", 0, "b", 10)).toThrowError(ProbaDeckError);
    expect(
      conditionKnowledgeTarget(fixed, "active", 0, new Set(["a"]), true, 10).hypotheses,
    ).toHaveLength(1);
    expect(
      conditionKnowledgeTarget(fixed, "active", 0, new Set(["b"]), false, 10).hypotheses,
    ).toHaveLength(1);
    expect(() =>
      conditionKnowledgeTarget(fixed, "active", 0, new Set(["b"]), true, 10),
    ).toThrowError(ProbaDeckError);

    const randomized = shuffleKnowledge(fixed, 0, 2, 10);
    const conditioned = conditionKnowledgeExact(randomized, "active", 0, "a", 10);
    expect(conditioned.hypotheses[0]?.active).toEqual([fixedCell("a"), fixedCell("b")]);
    expect(() => conditionKnowledgeExact(randomized, "active", 0, "missing", 10)).toThrowError(
      ProbaDeckError,
    );
    expect(
      conditionKnowledgeTarget(randomized, "active", 0, new Set(["a"]), true, 10).hypotheses,
    ).toHaveLength(1);
    expect(
      conditionKnowledgeTarget(randomized, "active", 0, new Set(["a"]), false, 10).hypotheses,
    ).toHaveLength(1);
    const missingPool = state(hypothesis([poolCell("missing")]));
    expect(() => conditionKnowledgeExact(missingPool, "active", 0, "a", 10)).toThrowError(
      ProbaDeckError,
    );
    expect(() =>
      conditionKnowledgeTarget(missingPool, "active", 0, new Set(["a"]), true, 10),
    ).toThrowError(Error);
    expect(() => removeKnownInstancesFromZone(missingPool, "active", ["a"], 10)).toThrowError(
      ProbaDeckError,
    );
    const drawn = drawKnowledge(randomized, 1);
    expect(conditionKnowledgeExact(drawn, "drawn", 0, "a", 10).hypotheses[0]?.drawn[0]).toEqual(
      fixedCell("a"),
    );
  });

  it("inserts, mixes, shuffles, and moves fixed and random components", () => {
    const fixed = createInitialKnowledge(["a", "b", "c"]);
    expect(insertKnownKnowledge(fixed, 1, ["x"], true, 10).hypotheses[0]?.active).toEqual([
      fixedCell("a"),
      fixedCell("x"),
      fixedCell("b"),
      fixedCell("c"),
    ]);
    expect(insertKnownKnowledge(fixed, 1, ["x", "y"], false, 10).hypotheses[0]?.active).toEqual([
      fixedCell("a"),
      fixedCell("x"),
      fixedCell("y"),
      fixedCell("b"),
      fixedCell("c"),
    ]);
    expect(() => insertKnownKnowledge(fixed, 0, [], true, 10)).toThrowError(Error);
    expect(mixKnowledgeStates([fixed], 10)).toBe(fixed);
    const alternate = createInitialKnowledge(["b", "a", "c"]);
    expect(mixKnowledgeStates([fixed, alternate], 10).hypotheses).toHaveLength(2);
    expect(shuffleKnowledge(fixed, 1, 2, 10)).toBe(fixed);
    const randomized = shuffleKnowledge(fixed, 0, 3, 10);
    expect(randomized.hypotheses[0]?.pools.get("pool-1")?.candidates).toEqual(["a", "b", "c"]);
    expect(shuffleKnowledge(randomized, 0, 2, 10).hypotheses.length).toBeGreaterThan(1);
    expect(() =>
      shuffleKnowledge(state(hypothesis([poolCell("missing"), fixedCell("b")])), 0, 2, 10),
    ).toThrowError(Error);
    expect(moveKnowledgeByIndices(fixed, [2], 0, false, 10).hypotheses[0]?.active).toEqual([
      fixedCell("c"),
      fixedCell("a"),
      fixedCell("b"),
    ]);
    expect(
      moveKnowledgeByIndices(randomized, [0, 1], 1, true, 10).hypotheses.length,
    ).toBeGreaterThan(1);
    expect(
      moveKnowledgeByIndicesOrdered(fixed, [0, 2], 1, [1, 0], 10).hypotheses[0]?.active,
    ).toEqual([fixedCell("b"), fixedCell("c"), fixedCell("a")]);
    expect(() => moveKnowledgeByIndicesOrdered(fixed, [0], 0, [1], 10)).toThrowError(Error);
  });

  it("removes and relocates known instances across both zones", () => {
    const fixedDrawn = state(hypothesis([fixedCell("a"), fixedCell("b")], [fixedCell("c")]));
    expect(
      removeKnownInstancesFromZone(fixedDrawn, "active", ["a"], 10).hypotheses[0]?.active,
    ).toEqual([fixedCell("b")]);
    expect(
      removeKnownInstancesFromZone(fixedDrawn, "drawn", ["c"], 10).hypotheses[0]?.drawn,
    ).toEqual([]);
    expect(
      relocateKnownInstances(fixedDrawn, "active", ["a"], 1, false, 10).hypotheses[0]?.active,
    ).toEqual([fixedCell("b"), fixedCell("a")]);
    expect(
      relocateKnownInstances(fixedDrawn, "drawn", ["c"], 0, false, 10).hypotheses[0],
    ).toMatchObject({
      active: [fixedCell("c"), fixedCell("a"), fixedCell("b")],
      drawn: [],
    });
    const randomized = shuffleKnowledge(createInitialKnowledge(["a", "b"]), 0, 2, 10);
    expect(removeKnownInstancesFromZone(randomized, "active", ["a"], 10).hypotheses.length).toBe(1);
    expect(
      relocateKnownInstances(randomized, "active", ["a", "b"], 0, true, 10).hypotheses[0]?.pools
        .size,
    ).toBe(1);
  });

  it("conditions revealed shuffles and rejects inconsistent outcomes", () => {
    const fixed = createInitialKnowledge(["a", "b", "c"]);
    expect(revealShuffleKnowledge(fixed, 0, 2, ["b", "a"], 10).hypotheses[0]?.active).toEqual([
      fixedCell("b"),
      fixedCell("a"),
      fixedCell("c"),
    ]);
    expect(() => revealShuffleKnowledge(fixed, 0, 2, ["c", "a"], 10)).toThrowError(ProbaDeckError);
    const randomized = shuffleKnowledge(fixed, 0, 3, 10);
    expect(revealShuffleKnowledge(randomized, 0, 2, ["a", "b"], 10).hypotheses[0]?.active).toEqual([
      fixedCell("a"),
      fixedCell("b"),
      fixedCell("c"),
    ]);
    expect(() => revealShuffleKnowledge(randomized, 0, 2, ["a", "missing"], 10)).toThrowError(
      ProbaDeckError,
    );
    expect(() =>
      revealShuffleKnowledge(
        state(hypothesis([poolCell("missing"), fixedCell("b")])),
        0,
        1,
        ["a"],
        10,
      ),
    ).toThrowError(Error);
  });
});
