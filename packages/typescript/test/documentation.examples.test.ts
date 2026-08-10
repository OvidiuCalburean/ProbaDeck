/* eslint-disable vitest/no-standalone-expect -- API example runners execute inside generated tests. */

import { readFileSync } from "node:fs";

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
  Pcg32Random,
  probabilityAtDraw,
  probabilityOfNext,
  probabilityWithinDraws,
  ProbaDeckError,
  replayEventLog,
  restoreSnapshot,
  serializeEventLog,
  serializeSnapshot,
  shuffleDeck,
  type CardCodec,
  type CardTarget,
  type Deck,
  type DeckConfig,
  type JsonValue,
  type ProbabilityResult,
  type RandomSource,
} from "../src/index.js";

const documentedRuntimeExports = [
  "createDeck",
  "getActiveCards",
  "getDrawnCards",
  "shuffleDeck",
  "insertCards",
  "moveCards",
  "drawCards",
  "observe",
  "probabilityOfNext",
  "probabilityAtDraw",
  "probabilityWithinDraws",
  "createSeededRandom",
  "Pcg32Random",
  "getAuditLog",
  "getObserverLog",
  "serializeSnapshot",
  "restoreSnapshot",
  "serializeEventLog",
  "replayEventLog",
  "ProbaDeckError",
] as const;

type DocumentedRuntimeExport = (typeof documentedRuntimeExports)[number];

interface DeckShape<TCard> {
  readonly name: string;
  readonly cards: readonly TCard[];
  readonly config: DeckConfig<TCard>;
  readonly codec: CardCodec<TCard>;
  readonly target: CardTarget;
  readonly seed: bigint;
}

type DocumentationExample = <TCard>(shape: DeckShape<TCard>) => void;

function initialDeck<TCard>(shape: DeckShape<TCard>): Deck<TCard> {
  return createDeck({
    cards: shape.cards,
    config: shape.config,
    random: createSeededRandom({ seed: shape.seed }),
  });
}

function shuffledDeck<TCard>(shape: DeckShape<TCard>): Deck<TCard> {
  return shuffleDeck(initialDeck(shape)).deck;
}

function workflowDeck<TCard>(shape: DeckShape<TCard>): Deck<TCard> {
  const shuffled = shuffledDeck(shape);
  const drawn = drawCards(shuffled, { count: 2 }).deck;
  const returnedId = getDrawnCards(drawn)[0]?.instanceId;
  if (returnedId === undefined) {
    throw new Error("Expected a drawn card for the documentation workflow.");
  }
  const inserted = insertCards(drawn, {
    items: [{ kind: "drawn", instanceId: returnedId }],
    placement: { kind: "from-bottom", offset: 0 },
  }).deck;
  return moveCards(inserted, {
    selection: { kind: "indices", indices: [0] },
    placement: { kind: "from-bottom", offset: 0 },
    visibility: "revealed",
  }).deck;
}

function expectValidProbability(result: ProbabilityResult): void {
  expect(result.exact.denominator).toBeGreaterThan(0n);
  expect(result.exact.numerator).toBeGreaterThanOrEqual(0n);
  expect(result.exact.numerator).toBeLessThanOrEqual(result.exact.denominator);
  expect(result.decimal).toBeGreaterThanOrEqual(0);
  expect(result.decimal).toBeLessThanOrEqual(1);
  expect(result.percentage).toBeCloseTo(result.decimal * 100, 12);
  expect(result.explanation.result).toEqual(result.exact);
}

const documentationExamples = {
  createDeck: <TCard>(shape: DeckShape<TCard>) => {
    const deck = initialDeck(shape);

    expect(deck).toMatchObject({
      revision: 0,
      length: shape.cards.length,
      drawnCount: 0,
      maxHypotheses: 10_000,
    });
    expect(getActiveCards(deck)[0]?.instanceId).toBe("instance-1");
  },

  getActiveCards: <TCard>(shape: DeckShape<TCard>) => {
    const deck = initialDeck(shape);
    const activeCards = getActiveCards(deck);

    expect(activeCards).toHaveLength(shape.cards.length);
    expect(activeCards[0]?.card).toEqual(shape.cards[0]);
    expect(Object.isFrozen(activeCards)).toBe(true);
  },

  getDrawnCards: <TCard>(shape: DeckShape<TCard>) => {
    const drawn = drawCards(initialDeck(shape), { count: 2 }).deck;
    const drawnCards = getDrawnCards(drawn);

    expect(drawnCards).toHaveLength(2);
    expect(drawnCards.map((instance) => instance.card)).toEqual(shape.cards.slice(0, 2));
  },

  shuffleDeck: <TCard>(shape: DeckShape<TCard>) => {
    const initial = initialDeck(shape);
    const {
      deck: shuffled,
      output,
      event,
    } = shuffleDeck(initial, {
      region: { startIndex: 0, endIndexExclusive: shape.cards.length },
      visibility: "hidden",
    });

    expect(shuffled.revision).toBe(1);
    expect(shuffled.length).toBe(initial.length);
    expect(output.referenceLength).toBe(shape.cards.length);
    expect(event.kind).toBe("deck.shuffled");
    expect(initial.revision).toBe(0);
  },

  insertCards: <TCard>(shape: DeckShape<TCard>) => {
    const drawn = drawCards(initialDeck(shape)).deck;
    const instanceId = getDrawnCards(drawn)[0]?.instanceId;
    if (instanceId === undefined) {
      throw new Error("Expected one drawn card.");
    }
    const { deck: returned, output } = insertCards(drawn, {
      items: [{ kind: "drawn", instanceId }],
      placement: { kind: "from-bottom", offset: 0 },
      visibility: "hidden",
    });

    expect(returned.drawnCount).toBe(0);
    expect(getActiveCards(returned).at(-1)?.instanceId).toBe(instanceId);
    expect(output.appliedGap).toBe(shape.cards.length - 1);
  },

  moveCards: <TCard>(shape: DeckShape<TCard>) => {
    const initial = initialDeck(shape);
    const firstId = getActiveCards(initial)[0]?.instanceId;
    const { deck: moved, output } = moveCards(initial, {
      selection: { kind: "indices", indices: [0] },
      placement: { kind: "from-bottom", offset: 0 },
      visibility: "revealed",
    });

    expect(getActiveCards(moved).at(-1)?.instanceId).toBe(firstId);
    expect(output.instanceIds).toEqual([firstId]);
    expect(moved.revision).toBe(1);
  },

  drawCards: <TCard>(shape: DeckShape<TCard>) => {
    const initial = initialDeck(shape);
    const { deck: afterHand, output } = drawCards(initial, { count: 2, reveal: true });

    expect(output.instances.map((instance) => instance.card)).toEqual(shape.cards.slice(0, 2));
    expect(output.revealed).toBe(true);
    expect(afterHand).toMatchObject({ length: shape.cards.length - 2, drawnCount: 2 });
  },

  observe: <TCard>(shape: DeckShape<TCard>) => {
    const shuffled = shuffledDeck(shape);
    const actual = getActiveCards(shuffled)[0];
    if (actual === undefined) {
      throw new Error("Expected an active top card.");
    }
    const { deck: conditioned, output } = observe(shuffled, {
      location: { zone: "active", index: 0 },
      evidence: { kind: "instance", instanceId: actual.instanceId },
    });

    expect(output.evidence).toEqual({ kind: "instance", instanceId: actual.instanceId });
    expect(conditioned.revision).toBe(shuffled.revision + 1);
    expect(
      probabilityOfNext(conditioned, { kind: "instance", instanceId: actual.instanceId }).exact,
    ).toEqual({ numerator: 1n, denominator: 1n });
  },

  probabilityOfNext: <TCard>(shape: DeckShape<TCard>) => {
    const result = probabilityOfNext(shuffledDeck(shape), shape.target);

    expectValidProbability(result);
    expect(result.explanation.query).toEqual({ kind: "next" });
    expect(result.explanation.target).toEqual(shape.target);
  },

  probabilityAtDraw: <TCard>(shape: DeckShape<TCard>) => {
    const result = probabilityAtDraw(shuffledDeck(shape), shape.target, 2);

    expectValidProbability(result);
    expect(result.explanation.query).toEqual({ kind: "at-draw", drawNumber: 2 });
  },

  probabilityWithinDraws: <TCard>(shape: DeckShape<TCard>) => {
    const deck = shuffledDeck(shape);
    const exactDraw = probabilityAtDraw(deck, shape.target, 2);
    const result = probabilityWithinDraws(deck, shape.target, 3);

    expectValidProbability(result);
    expect(result.decimal).toBeGreaterThanOrEqual(exactDraw.decimal);
    expect(result.explanation.query).toEqual({ kind: "within-draws", drawCount: 3 });
  },

  createSeededRandom: <TCard>(shape: DeckShape<TCard>) => {
    let first: RandomSource = createSeededRandom({ seed: shape.seed, stream: 7n });
    let second: RandomSource = createSeededRandom({ seed: shape.seed, stream: 7n });

    for (let index = 0; index < 5; index += 1) {
      const firstStep = first.nextUint32();
      const secondStep = second.nextUint32();
      expect(firstStep.value).toBe(secondStep.value);
      first = firstStep.next;
      second = secondStep.next;
    }
  },

  Pcg32Random: <TCard>(_shape: DeckShape<TCard>) => {
    const random = new Pcg32Random(42n, 3n);
    const { value, next } = random.nextUint32();

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffff_ffff);
    expect(next).toBeInstanceOf(Pcg32Random);
    expect(next).not.toBe(random);
    expect(random.algorithm).toBe("pcg32-v1");
  },

  getAuditLog: <TCard>(shape: DeckShape<TCard>) => {
    const shuffled = shuffledDeck(shape);
    const auditLog = getAuditLog(shuffled);

    expect(auditLog.map((event) => event.sequence)).toEqual([0, 1]);
    expect(auditLog[1]?.kind).toBe("deck.shuffled");
    expect(auditLog[1]?.resolution.instanceIds).toBeInstanceOf(Array);
  },

  getObserverLog: <TCard>(shape: DeckShape<TCard>) => {
    const shuffled = shuffledDeck(shape);
    const observerLog = getObserverLog(shuffled);

    expect(observerLog.map((event) => event.sequence)).toEqual([0, 1]);
    expect(observerLog[1]?.kind).toBe("deck.shuffled");
    expect(observerLog[1]?.details.instanceIds).toBeNull();
  },

  serializeSnapshot: <TCard>(shape: DeckShape<TCard>) => {
    const deck = workflowDeck(shape);
    const snapshot = serializeSnapshot(deck, shape.codec);

    expect(snapshot.schemaVersion).toBe("probadeck.snapshot/v1");
    expect(snapshot.revision).toBe(deck.revision);
    expect(snapshot.instances).toHaveLength(shape.cards.length);
  },

  restoreSnapshot: <TCard>(shape: DeckShape<TCard>) => {
    const deck = workflowDeck(shape);
    const snapshot = serializeSnapshot(deck, shape.codec);
    const restored = restoreSnapshot(snapshot, { config: shape.config, codec: shape.codec });

    expect(restored.revision).toBe(deck.revision);
    expect(getActiveCards(restored)).toEqual(getActiveCards(deck));
    expect(getDrawnCards(restored)).toEqual(getDrawnCards(deck));
  },

  serializeEventLog: <TCard>(shape: DeckShape<TCard>) => {
    const deck = workflowDeck(shape);
    const eventLog = serializeEventLog(deck, shape.codec);

    expect(eventLog.schemaVersion).toBe("probadeck.events/v1");
    expect(eventLog.snapshot).toBeDefined();
    expect(JSON.stringify(eventLog)).toContain("deck.created");
  },

  replayEventLog: <TCard>(shape: DeckShape<TCard>) => {
    const deck = workflowDeck(shape);
    const eventLog = serializeEventLog(deck, shape.codec);
    const replayed = replayEventLog(eventLog, { config: shape.config, codec: shape.codec });
    const prefix = replayEventLog(eventLog, {
      config: shape.config,
      codec: shape.codec,
      throughSequence: 2,
    });

    expect(replayed.revision).toBe(deck.revision);
    expect(getActiveCards(replayed)).toEqual(getActiveCards(deck));
    expect(getDrawnCards(replayed)).toEqual(getDrawnCards(deck));
    expect(prefix.revision).toBe(2);
  },

  ProbaDeckError: <TCard>(shape: DeckShape<TCard>) => {
    const error = new ProbaDeckError("INVALID_COUNT", "Example error", { count: 999 });

    expect(error).toMatchObject({
      name: "ProbaDeckError",
      code: "INVALID_COUNT",
      details: { count: 999 },
    });
    expect(() => drawCards(initialDeck(shape), { count: 999 })).toThrowError(
      expect.objectContaining({ code: "INVALID_COUNT" }),
    );
  },
} satisfies Record<DocumentedRuntimeExport, DocumentationExample>;

interface PlayingCard {
  readonly rank: string;
  readonly suit: string;
}

const playingCardShape: DeckShape<PlayingCard> = {
  name: "standard playing cards",
  cards: [
    { rank: "A", suit: "heart" },
    { rank: "K", suit: "club" },
    { rank: "Q", suit: "diamond" },
    { rank: "J", suit: "spade" },
    { rank: "10", suit: "heart" },
    { rank: "9", suit: "club" },
    { rank: "8", suit: "diamond" },
    { rank: "7", suit: "spade" },
  ],
  config: {
    cardKey: (card) => `${card.rank}-${card.suit}`,
    classifiers: {
      suit: (card) => card.suit,
      color: (card) => (card.suit === "heart" || card.suit === "diamond" ? "red" : "black"),
    },
  },
  codec: {
    encode: (card) => ({ rank: card.rank, suit: card.suit }),
    decode: (value) => {
      const card = jsonRecord(value, "playing card");
      return { rank: jsonString(card.rank, "rank"), suit: jsonString(card.suit, "suit") };
    },
  },
  target: { kind: "classifier", classifier: "color", value: "red" },
  seed: 101n,
};

interface TradingCard {
  readonly name: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly copy: number;
}

const tradingCardShape: DeckShape<TradingCard> = {
  name: "duplicate-heavy trading cards",
  cards: [
    { name: "Forest", kind: "land", tags: ["resource", "green"], copy: 1 },
    { name: "Forest", kind: "land", tags: ["resource", "green"], copy: 2 },
    { name: "Island", kind: "land", tags: ["resource", "blue"], copy: 1 },
    { name: "Guide", kind: "creature", tags: ["green", "ally"], copy: 1 },
    { name: "Guide", kind: "creature", tags: ["green", "ally"], copy: 2 },
    { name: "Counter", kind: "spell", tags: ["blue", "interaction"], copy: 1 },
    { name: "Draw", kind: "spell", tags: ["blue", "card-advantage"], copy: 1 },
    { name: "Relic", kind: "artifact", tags: ["colorless", "utility"], copy: 1 },
  ],
  config: {
    cardKey: (card) => card.name,
    classifiers: { kind: (card) => card.kind, tag: (card) => card.tags },
  },
  codec: {
    encode: (card) => ({
      name: card.name,
      kind: card.kind,
      tags: card.tags,
      copy: card.copy,
    }),
    decode: (value) => {
      const card = jsonRecord(value, "trading card");
      return {
        name: jsonString(card.name, "name"),
        kind: jsonString(card.kind, "kind"),
        tags: jsonStrings(card.tags, "tags"),
        copy: jsonNumber(card.copy, "copy"),
      };
    },
  },
  target: { kind: "classifier", classifier: "kind", value: "land" },
  seed: 202n,
};

interface EncounterCard {
  readonly id: string;
  readonly difficulty: "safe" | "dangerous";
  readonly regions: readonly string[];
}

const encounterCardShape: DeckShape<EncounterCard> = {
  name: "multi-tag encounter cards",
  cards: [
    { id: "quiet-cave", difficulty: "safe", regions: ["cave"] },
    { id: "cave-spider", difficulty: "dangerous", regions: ["cave", "forest"] },
    { id: "sunlit-path", difficulty: "safe", regions: ["forest", "road"] },
    { id: "bandit", difficulty: "dangerous", regions: ["road"] },
    { id: "healing-spring", difficulty: "safe", regions: ["cave", "mountain"] },
    { id: "rockslide", difficulty: "dangerous", regions: ["mountain"] },
    { id: "lost-map", difficulty: "safe", regions: ["forest"] },
    { id: "storm", difficulty: "dangerous", regions: ["road", "mountain"] },
  ],
  config: {
    cardKey: (card) => card.id,
    classifiers: {
      difficulty: (card) => card.difficulty,
      region: (card) => card.regions,
    },
  },
  codec: {
    encode: (card) => ({
      id: card.id,
      difficulty: card.difficulty,
      regions: card.regions,
    }),
    decode: (value) => {
      const card = jsonRecord(value, "encounter card");
      const difficulty = jsonString(card.difficulty, "difficulty");
      if (difficulty !== "safe" && difficulty !== "dangerous") {
        throw new TypeError("difficulty must be safe or dangerous.");
      }
      return {
        id: jsonString(card.id, "id"),
        difficulty,
        regions: jsonStrings(card.regions, "regions"),
      };
    },
  },
  target: { kind: "classifier", classifier: "region", value: "cave" },
  seed: 303n,
};

function jsonRecord(value: JsonValue, field: string): Readonly<Record<string, JsonValue>> {
  if (!isJsonRecord(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function isJsonRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string.`);
  }
  return value;
}

function jsonNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a safe integer.`);
  }
  return value;
}

function jsonStrings(value: JsonValue | undefined, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array.`);
  }
  return value.map((entry) => jsonString(entry, field));
}

function sortedStrings(values: readonly string[]): readonly string[] {
  const copy = [...values];
  // eslint-disable-next-line unicorn/no-array-sort -- The package's public runtime target is ES2022.
  return copy.sort((left, right) => left.localeCompare(right));
}

describe("documentation example coverage", () => {
  it("keeps the website API manifest and executable examples in lockstep", () => {
    const referenceSource = readFileSync(
      new URL("../../../examples/showcase/src/docs/reference.ts", import.meta.url),
      "utf8",
    );
    const typeGroupsStart = referenceSource.indexOf("export const typeGroups");
    const apiReferenceSource = referenceSource.slice(
      0,
      typeGroupsStart === -1 ? referenceSource.length : typeGroupsStart,
    );
    const entryBlocks = [...apiReferenceSource.matchAll(/^ {6}\{\n([\s\S]*?)^ {6}\},?$/gm)].map(
      (match) => match[1] ?? "",
    );
    const names = entryBlocks.flatMap((entry) => {
      const match = /^ {8}name: "([^"]+)",$/m.exec(entry);
      return match?.[1] === undefined ? [] : [match[1]];
    });
    const expectedNames = sortedStrings(documentedRuntimeExports);

    expect(sortedStrings(names)).toEqual(expectedNames);
    expect(sortedStrings(Object.keys(documentationExamples))).toEqual(expectedNames);
    for (const entry of entryBlocks) {
      const name = /^ {8}name: "([^"]+)",$/m.exec(entry)?.[1];
      expect(entry, `${name ?? "API entry"} must have a documentation example`).toContain(
        "example:",
      );
      expect(entry).toContain(name);
    }
  });
});

function defineDeckShapeSuite<TCard>(shape: DeckShape<TCard>): void {
  describe(`documentation examples with ${shape.name}`, () => {
    for (const name of documentedRuntimeExports) {
      it(`${name} executes with this card shape`, () => {
        expect.hasAssertions();
        documentationExamples[name](shape);
      });
    }
  });
}

defineDeckShapeSuite(playingCardShape);
defineDeckShapeSuite(tradingCardShape);
defineDeckShapeSuite(encounterCardShape);
