import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  drawCards,
  getActiveCards,
  getAuditLog,
  getDrawnCards,
  getObserverLog,
  insertCards,
  moveCards,
  observe,
  ProbaDeckError,
  shuffleDeck,
} from "../src/index.js";

interface TestCard {
  readonly name: string;
  readonly suit: string;
}

const config = {
  cardKey: (card: TestCard) => card.name,
  classifiers: { suit: (card: TestCard) => card.suit },
};

const cards: readonly TestCard[] = Object.freeze([
  { name: "ace", suit: "hearts" },
  { name: "king", suit: "clubs" },
  { name: "queen", suit: "diamonds" },
  { name: "jack", suit: "spades" },
]);

describe("immutable deck operations", () => {
  it("shuffles, draws, reinserts, and retains old snapshots", () => {
    const initial = createDeck({ cards, config, random: createSeededRandom({ seed: 42n }) });
    const shuffled = shuffleDeck(initial);
    const drawn = drawCards(shuffled.deck, { count: 2 });
    const drawnIds = drawn.output.instances.map((instance) => instance.instanceId);
    const inserted = insertCards(drawn.deck, {
      items: drawnIds.map((instanceId) => ({ kind: "drawn" as const, instanceId })),
      placement: { kind: "from-bottom", offset: 0 },
    });

    expect(getActiveCards(initial).map((instance) => instance.card.name)).toEqual([
      "ace",
      "king",
      "queen",
      "jack",
    ]);
    expect(initial.revision).toBe(0);
    expect(shuffled.deck.revision).toBe(1);
    expect(getDrawnCards(drawn.deck)).toHaveLength(2);
    expect(getDrawnCards(inserted.deck)).toHaveLength(0);
    expect(
      getActiveCards(inserted.deck)
        .map((instance) => instance.instanceId)
        .slice(-2),
    ).toEqual(drawnIds);
    expect(getAuditLog(inserted.deck).map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
  });

  it("redacts hidden random resolutions from the observer log", () => {
    const initial = createDeck({ cards, config, random: createSeededRandom({ seed: 7n }) });
    const hidden = shuffleDeck(initial);
    const revealed = shuffleDeck(hidden.deck, { visibility: "revealed" });

    expect(getAuditLog(hidden.deck)[1]?.resolution.instanceIds).toBeInstanceOf(Array);
    expect(getObserverLog(hidden.deck)[1]?.details.instanceIds).toBeNull();
    expect(getObserverLog(revealed.deck)[2]?.details.instanceIds).toBeInstanceOf(Array);
  });

  it("moves a simultaneous selection relative to the post-removal deck", () => {
    const initial = createDeck({ cards, config });
    const moved = moveCards(initial, {
      selection: { kind: "indices", indices: [3, 1] },
      placement: { kind: "index", index: 0 },
      visibility: "revealed",
    });

    expect(moved.output).toMatchObject({
      instanceIds: ["instance-2", "instance-4"],
      requestedPlacement: { kind: "index", index: 0 },
      appliedGap: 0,
      referenceLength: 2,
      wasClamped: false,
    });
    expect(getActiveCards(moved.deck).map((instance) => instance.instanceId)).toEqual([
      "instance-2",
      "instance-4",
      "instance-1",
      "instance-3",
    ]);
  });

  it("supports clamped placement and new cards", () => {
    const initial = createDeck({ cards: cards.slice(0, 1), config });
    const inserted = insertCards(initial, {
      items: [{ kind: "new", card: { name: "ten", suit: "hearts" }, instanceId: "ten-1" }],
      placement: { kind: "index", index: 99 },
      bounds: "clamp",
    });

    expect(inserted.output).toMatchObject({
      requestedPlacement: { kind: "index", index: 99 },
      appliedGap: 1,
      referenceLength: 1,
      wasClamped: true,
    });
    expect(getActiveCards(inserted.deck).map((instance) => instance.instanceId)).toEqual([
      "instance-1",
      "ten-1",
    ]);
  });

  it("conditions exact and selector observations and rejects contradictions", () => {
    const initial = createDeck({ cards, config, random: createSeededRandom({ seed: 9n }) });
    const shuffled = shuffleDeck(initial);
    const actual = getActiveCards(shuffled.deck)[0];
    if (actual === undefined) {
      throw new Error("Expected a top card.");
    }
    const exact = observe(shuffled.deck, {
      location: { zone: "active", index: 0 },
      evidence: { kind: "instance", instanceId: actual.instanceId },
    });
    const selector = observe(exact.deck, {
      location: { zone: "active", index: 0 },
      evidence: {
        kind: "target",
        target: { kind: "classifier", classifier: "suit", value: actual.card.suit },
        matches: true,
      },
    });

    expect(selector.deck.revision).toBe(3);
    expect(() =>
      observe(shuffled.deck, {
        location: { zone: "active", index: 0 },
        evidence: {
          kind: "instance",
          instanceId: actual.instanceId === "instance-1" ? "instance-2" : "instance-1",
        },
      }),
    ).toThrowError(ProbaDeckError);
  });

  it("covers no-op, regional, clamped, and missing-random shuffles", () => {
    const one = createDeck({ cards: cards.slice(0, 1), config });
    expect(shuffleDeck(one).deck.revision).toBe(1);
    const manyWithoutRandom = createDeck({ cards, config });
    expect(() => shuffleDeck(manyWithoutRandom)).toThrowError(
      expect.objectContaining({ code: "RANDOM_SOURCE_REQUIRED" }),
    );
    const many = createDeck({ cards, config, random: createSeededRandom({ seed: 5n }) });
    const regional = shuffleDeck(many, {
      region: { startIndex: -2, endIndexExclusive: 2 },
      bounds: "clamp",
      visibility: "revealed",
    });
    expect(regional.output).toMatchObject({
      requestedRegion: { startIndex: -2, endIndexExclusive: 2 },
      region: { startIndex: 0, endIndexExclusive: 2 },
      referenceLength: 4,
      wasClamped: true,
    });
  });

  it("validates insertion sources, duplicates, and random order", () => {
    const initial = createDeck({ cards, config, random: createSeededRandom({ seed: 12n }) });
    expect(() =>
      insertCards(initial, { items: [], placement: { kind: "index", index: 0 } }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_COUNT" }));
    expect(() =>
      insertCards(initial, {
        items: [{ kind: "drawn", instanceId: "instance-1" }],
        placement: { kind: "index", index: 0 },
      }),
    ).toThrowError(expect.objectContaining({ code: "INSTANCE_NOT_DRAWN" }));
    const drawn = drawCards(initial, { count: 1 }).deck;
    expect(() =>
      insertCards(drawn, {
        items: [
          { kind: "drawn", instanceId: "instance-1" },
          { kind: "drawn", instanceId: "instance-1" },
        ],
        placement: { kind: "index", index: 0 },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION" }));
    const inserted = insertCards(drawn, {
      items: [
        { kind: "new", card: { name: "nine", suit: "clubs" } },
        { kind: "new", card: { name: "eight", suit: "clubs" } },
      ],
      placement: { kind: "random-within", startGap: 0, endGap: drawn.length },
      order: "random",
      visibility: "revealed",
    });
    expect(inserted.output.instances).toHaveLength(2);
    expect(inserted.event.resolution.randomDecisions).not.toEqual([]);
  });

  it("validates every move selection and supports hidden and revealed ID moves", () => {
    const initial = createDeck({ cards, config, random: createSeededRandom({ seed: 22n }) });
    const invalidSelections = [
      { kind: "indices" as const, indices: [] },
      { kind: "indices" as const, indices: [0.5] },
      { kind: "indices" as const, indices: [-1] },
      { kind: "indices" as const, indices: [0, 0] },
    ];
    for (const selection of invalidSelections) {
      expect(() =>
        moveCards(initial, { selection, placement: { kind: "index", index: 0 } }),
      ).toThrowError(ProbaDeckError);
    }
    for (const instanceIds of [[], [""], ["instance-1", "instance-1"], ["missing"]]) {
      expect(() =>
        moveCards(initial, {
          selection: { kind: "instances", instanceIds },
          placement: { kind: "index", index: 0 },
        }),
      ).toThrowError(ProbaDeckError);
    }
    const drawn = drawCards(initial).deck;
    expect(() =>
      moveCards(drawn, {
        selection: { kind: "instances", instanceIds: ["instance-1"] },
        placement: { kind: "index", index: 0 },
      }),
    ).toThrowError(ProbaDeckError);

    const hidden = moveCards(initial, {
      selection: { kind: "instances", instanceIds: ["instance-1", "instance-3"] },
      placement: { kind: "random-within", startGap: 0, endGap: 2 },
      order: "random",
    });
    expect(hidden.output.instanceIds).toHaveLength(2);
    expect(hidden.event.observation.details.appliedGap).toBeNull();
    const revealed = moveCards(hidden.deck, {
      selection: { kind: "instances", instanceIds: hidden.output.instanceIds },
      placement: { kind: "from-bottom", offset: 0 },
      visibility: "revealed",
      order: "random",
    });
    expect(revealed.event.observation.details.sourceIndices).toBeInstanceOf(Array);
  });

  it("validates draw and observation bounds and composite evidence", () => {
    const initial = createDeck({ cards, config });
    for (const count of [0, -1, 1.5, 5]) {
      expect(() => drawCards(initial, { count })).toThrowError(ProbaDeckError);
    }
    expect(() =>
      observe(initial, {
        location: { zone: "active", index: -1 },
        evidence: { kind: "instance", instanceId: "instance-1" },
      }),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      observe(initial, {
        location: { zone: "drawn", index: 0 },
        evidence: { kind: "instance", instanceId: "instance-1" },
      }),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      observe(initial, {
        location: { zone: "active", index: 0 },
        evidence: {
          kind: "target",
          target: { kind: "card-key", cardKey: "king" },
          matches: true,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "IMPOSSIBLE_OBSERVATION" }));

    let deck = initial;
    const matchingTargets = [
      { kind: "instance", instanceId: "instance-1" } as const,
      { kind: "card-key", cardKey: "ace" } as const,
      { kind: "not", target: { kind: "card-key", cardKey: "king" } } as const,
      {
        kind: "all",
        targets: [
          { kind: "card-key", cardKey: "ace" },
          { kind: "classifier", classifier: "suit", value: "hearts" },
        ],
      } as const,
      {
        kind: "any",
        targets: [
          { kind: "card-key", cardKey: "missing" },
          { kind: "card-key", cardKey: "ace" },
        ],
      } as const,
    ];
    for (const target of matchingTargets) {
      deck = observe(deck, {
        location: { zone: "active", index: 0 },
        evidence: { kind: "target", target, matches: true },
      }).deck;
    }
    expect(deck.revision).toBe(5);
  });

  it("requires randomness for random multi-card insertion and movement", () => {
    const initial = createDeck({ cards, config });
    expect(() =>
      insertCards(initial, {
        items: [
          { kind: "new", card: { name: "x", suit: "hearts" } },
          { kind: "new", card: { name: "y", suit: "hearts" } },
        ],
        placement: { kind: "index", index: 0 },
        order: "random",
      }),
    ).toThrowError(expect.objectContaining({ code: "RANDOM_SOURCE_REQUIRED" }));
    expect(() =>
      moveCards(initial, {
        selection: { kind: "indices", indices: [0, 1] },
        placement: { kind: "index", index: 0 },
        order: "random",
      }),
    ).toThrowError(expect.objectContaining({ code: "RANDOM_SOURCE_REQUIRED" }));
  });

  it("fails inference preflight before consuming randomness", () => {
    let calls = 0;
    const random = {
      algorithm: "counting",
      nextUint32: () => {
        calls += 1;
        return { value: 1, next: random };
      },
    };
    const initial = createDeck({ cards: cards.slice(0, 1), config, random, maxHypotheses: 1 });
    expect(() =>
      insertCards(initial, {
        items: [{ kind: "new", card: { name: "x", suit: "hearts" } }],
        placement: { kind: "random-within", startGap: 0, endGap: 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "INFERENCE_LIMIT_EXCEEDED" }));
    expect(calls).toBe(0);
  });
});
