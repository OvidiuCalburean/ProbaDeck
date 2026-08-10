import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  drawCards,
  getActiveCards,
  insertCards,
  probabilityAtDraw,
  probabilityOfNext,
  probabilityWithinDraws,
  shuffleDeck,
} from "../src/index.js";

interface NumberCard {
  readonly value: number;
  readonly group: string;
}

const config = {
  cardKey: (card: NumberCard) => String(card.value),
  classifiers: { group: (card: NumberCard) => card.group },
};

function tenCardDeck() {
  const cards = Array.from({ length: 10 }, (_value, index) => ({
    value: index + 1,
    group: index < 3 ? "target" : "other",
  }));
  return createDeck({ cards, config, random: createSeededRandom({ seed: 123n }) });
}

describe("exact probability queries", () => {
  it("locks the shuffled ten-card examples", () => {
    const shuffled = shuffleDeck(tenCardDeck()).deck;
    const one = { kind: "instance", instanceId: "instance-1" } as const;
    const three = { kind: "classifier", classifier: "group", value: "target" } as const;

    for (let draw = 1; draw <= 10; draw += 1) {
      expect(probabilityAtDraw(shuffled, one, draw).exact).toEqual({
        numerator: 1n,
        denominator: 10n,
      });
    }
    expect(probabilityWithinDraws(shuffled, one, 2).exact).toEqual({
      numerator: 1n,
      denominator: 5n,
    });
    expect(probabilityAtDraw(shuffled, three, 7).exact).toEqual({
      numerator: 3n,
      denominator: 10n,
    });
    expect(probabilityWithinDraws(shuffled, three, 2).exact).toEqual({
      numerator: 8n,
      denominator: 15n,
    });
  });

  it("conditions the next-card probability after revealed misses", () => {
    let deck = shuffleDeck(tenCardDeck()).deck;
    const targetId = getActiveCards(deck)[9]?.instanceId;
    if (targetId === undefined) {
      throw new Error("Expected a tenth card.");
    }

    for (let misses = 1; misses <= 3; misses += 1) {
      const drawn = drawCards(deck);
      deck = drawn.deck;
      expect(probabilityOfNext(deck, { kind: "instance", instanceId: targetId }).exact).toEqual({
        numerator: 1n,
        denominator: BigInt(10 - misses),
      });
    }
  });

  it("distinguishes fixed copies inside and outside a prefix", () => {
    const deck = tenCardDeck();
    const target = { kind: "classifier", classifier: "group", value: "target" } as const;
    const result = probabilityWithinDraws(deck, target, 2);

    expect(result.exact).toEqual({ numerator: 1n, denominator: 1n });
    expect(result.explanation.matchingInstances).toEqual([
      { instanceId: "instance-1", reason: "deterministic-hit" },
      { instanceId: "instance-2", reason: "deterministic-hit" },
      { instanceId: "instance-3", reason: "outside-query" },
    ]);
    expect(probabilityWithinDraws(deck, target, 0).exact).toEqual({
      numerator: 0n,
      denominator: 1n,
    });
  });

  it("validates every query boundary and fixed miss", () => {
    const empty = createDeck({ cards: [], config });
    expect(() => probabilityOfNext(empty, { kind: "card-key", cardKey: "1" })).toThrowError(
      expect.objectContaining({ code: "EMPTY_DECK" }),
    );
    const deck = tenCardDeck();
    for (const drawNumber of [0, 11, 1.5]) {
      expect(() =>
        probabilityAtDraw(deck, { kind: "card-key", cardKey: "1" }, drawNumber),
      ).toThrowError(expect.objectContaining({ code: "INVALID_COUNT" }));
    }
    for (const drawCount of [-1, 11, 1.5]) {
      expect(() =>
        probabilityWithinDraws(deck, { kind: "card-key", cardKey: "1" }, drawCount),
      ).toThrowError(expect.objectContaining({ code: "INVALID_COUNT" }));
    }
    expect(probabilityOfNext(deck, { kind: "card-key", cardKey: "missing" }).exact).toEqual({
      numerator: 0n,
      denominator: 1n,
    });
    expect(probabilityWithinDraws(deck, { kind: "card-key", cardKey: "10" }, 2).exact).toEqual({
      numerator: 0n,
      denominator: 1n,
    });
  });

  it("explains drawn pools, unqueried pools, and multiple independent pool factors", () => {
    const shuffled = shuffleDeck(tenCardDeck()).deck;
    expect(
      probabilityWithinDraws(shuffled, { kind: "instance", instanceId: "instance-1" }, 0)
        .explanation.matchingInstances,
    ).toEqual([{ instanceId: "instance-1", reason: "no-queried-pool-location" }]);
    const allHiddenDrawn = drawCards(shuffled, { count: 10, reveal: false }).deck;
    expect(
      probabilityWithinDraws(allHiddenDrawn, { kind: "instance", instanceId: "instance-1" }, 0)
        .explanation.matchingInstances,
    ).toEqual([{ instanceId: "instance-1", reason: "drawn" }]);

    const independent = insertCards(
      insertCards(createDeck({ cards: [], config, random: createSeededRandom({ seed: 4n }) }), {
        items: [
          { kind: "new", card: { value: 1, group: "target" }, instanceId: "a" },
          { kind: "new", card: { value: 2, group: "other" }, instanceId: "b" },
        ],
        placement: { kind: "index", index: 0 },
        order: "random",
      }).deck,
      {
        items: [
          { kind: "new", card: { value: 3, group: "target" }, instanceId: "c" },
          { kind: "new", card: { value: 4, group: "other" }, instanceId: "d" },
        ],
        placement: { kind: "index", index: 1 },
        order: "random",
      },
    ).deck;
    const result = probabilityWithinDraws(
      independent,
      { kind: "classifier", classifier: "group", value: "target" },
      2,
    );
    expect(result.exact).toEqual({ numerator: 3n, denominator: 4n });
    expect(result.explanation.hypotheses[0]?.formula.kind).toBe("complement");
  });

  it("marks a revealed draw as ineligible while retaining old-snapshot probability", () => {
    const shuffled = shuffleDeck(tenCardDeck()).deck;
    const targetId = getActiveCards(shuffled)[0]?.instanceId;
    if (targetId === undefined) {
      throw new Error("Expected a top card.");
    }
    const before = probabilityOfNext(shuffled, { kind: "instance", instanceId: targetId });
    const afterDraw = drawCards(shuffled).deck;
    const after = probabilityWithinDraws(
      afterDraw,
      { kind: "instance", instanceId: targetId },
      afterDraw.length,
    );
    expect(before.exact).toEqual({ numerator: 1n, denominator: 10n });
    expect(after.exact).toEqual({ numerator: 0n, denominator: 1n });
    expect(after.explanation.matchingInstances).toEqual([
      { instanceId: targetId, reason: "drawn" },
    ]);
  });
});
