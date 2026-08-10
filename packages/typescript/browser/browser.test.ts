import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  probabilityAtDraw,
  probabilityWithinDraws,
  shuffleDeck,
} from "../src/index.js";

describe("browser ESM runtime", () => {
  it("runs deterministic simulation and exact knowledge math in Chromium", () => {
    const deck = createDeck({
      cards: Array.from({ length: 10 }, (_value, index) => ({ id: index + 1 })),
      config: { cardKey: (card) => String(card.id) },
      random: createSeededRandom({ seed: 42n }),
    });
    const shuffled = shuffleDeck(deck).deck;
    const target = { kind: "instance", instanceId: "instance-1" } as const;

    expect(probabilityAtDraw(shuffled, target, 7).exact).toEqual({
      numerator: 1n,
      denominator: 10n,
    });
    expect(probabilityWithinDraws(shuffled, target, 3).exact).toEqual({
      numerator: 3n,
      denominator: 10n,
    });
  });
});
