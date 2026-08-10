import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  drawCards,
  getActiveCards,
  getDrawnCards,
  insertCards,
  moveCards,
  probabilityAtDraw,
  probabilityWithinDraws,
  shuffleDeck,
} from "../src/index.js";

interface PropertyCard {
  readonly key: string;
  readonly matches: string;
}

const config = {
  cardKey: (card: PropertyCard) => card.key,
  classifiers: { matches: (card: PropertyCard) => card.matches },
};

const configuredPropertyRuns = Number.parseInt(process.env.PROBADECK_PROPERTY_RUNS ?? "", 10);

function propertyRuns(fallback: number): number {
  return Number.isSafeInteger(configuredPropertyRuns) && configuredPropertyRuns > 0
    ? configuredPropertyRuns
    : fallback;
}

function cardsOfLength(length: number): readonly PropertyCard[] {
  return Object.freeze(
    Array.from({ length }, (_value, index) => ({
      key: `card-${index}`,
      matches: index % 2 === 0 ? "yes" : "no",
    })),
  );
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) {
    return [Object.freeze([...values])];
  }
  const result: (readonly T[])[] = [];
  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(rest)) {
      result.push(Object.freeze([value, ...suffix]));
    }
  });
  return Object.freeze(result);
}

describe("property and exhaustive verification", () => {
  it("matches an exhaustive permutation oracle for decks up to seven cards", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 7 }),
        fc.integer({ min: 0, max: 6 }),
        (length, rawDraw) => {
          const draw = (rawDraw % length) + 1;
          const cards = cardsOfLength(length);
          const initial = createDeck({
            cards,
            config,
            random: createSeededRandom({ seed: BigInt(length * 100 + draw) }),
          });
          const shuffled = shuffleDeck(initial).deck;
          const targetId = "instance-1";
          const worlds = permutations(
            Array.from({ length }, (_value, index) => `instance-${index + 1}`),
          );
          const exactHits = worlds.filter((world) => world[draw - 1] === targetId).length;
          const withinHits = worlds.filter((world) =>
            world.slice(0, draw).includes(targetId),
          ).length;

          expect(
            probabilityAtDraw(shuffled, { kind: "instance", instanceId: targetId }, draw).decimal,
          ).toBeCloseTo(exactHits / worlds.length, 14);
          expect(
            probabilityWithinDraws(shuffled, { kind: "instance", instanceId: targetId }, draw)
              .decimal,
          ).toBeCloseTo(withinHits / worlds.length, 14);
        },
      ),
      { numRuns: propertyRuns(25) },
    );
  });

  it("preserves instances, immutability, and seed determinism across command sequences", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.nat({ max: 10_000 }), (length, seed) => {
        const cards = cardsOfLength(length);
        const first = createDeck({
          cards,
          config,
          random: createSeededRandom({ seed: BigInt(seed) }),
        });
        const second = createDeck({
          cards,
          config,
          random: createSeededRandom({ seed: BigInt(seed) }),
        });
        const firstShuffle = shuffleDeck(first).deck;
        const secondShuffle = shuffleDeck(second).deck;
        const oldOrder = getActiveCards(first).map((instance) => instance.instanceId);

        expect(getActiveCards(firstShuffle)).toEqual(getActiveCards(secondShuffle));
        const drawn = drawCards(firstShuffle, { count: 1 }).deck;
        const moved = moveCards(drawn, {
          selection: { kind: "indices", indices: [drawn.length - 1] },
          placement: { kind: "from-top", offset: 0 },
        }).deck;
        const drawnId = getDrawnCards(drawn)[0]?.instanceId;
        if (drawnId === undefined) {
          throw new Error("Expected one drawn instance.");
        }
        const restored = insertCards(moved, {
          items: [{ kind: "drawn", instanceId: drawnId }],
          placement: { kind: "from-bottom", offset: 0 },
        }).deck;
        const allIds = [
          ...getActiveCards(restored).map((instance) => instance.instanceId),
          ...getDrawnCards(restored).map((instance) => instance.instanceId),
        ];

        expect(new Set(allIds).size).toBe(length);
        expect(allIds).toHaveLength(length);
        expect(getActiveCards(first).map((instance) => instance.instanceId)).toEqual(oldOrder);
      }),
      { numRuns: propertyRuns(50) },
    );
  });

  it("keeps cumulative probabilities bounded and monotone", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.nat({ max: 1000 }), (length, seed) => {
        const shuffled = shuffleDeck(
          createDeck({
            cards: cardsOfLength(length),
            config,
            random: createSeededRandom({ seed: BigInt(seed) }),
          }),
        ).deck;
        let previous = 0;
        for (let count = 0; count <= length; count += 1) {
          const current = probabilityWithinDraws(
            shuffled,
            { kind: "classifier", classifier: "matches", value: "yes" },
            count,
          ).decimal;
          expect(current).toBeGreaterThanOrEqual(previous);
          expect(current).toBeGreaterThanOrEqual(0);
          expect(current).toBeLessThanOrEqual(1);
          previous = current;
        }
      }),
      { numRuns: propertyRuns(40) },
    );
  });

  it("models hidden random placement and hidden draws without disclosure", () => {
    const inserted = insertCards(
      createDeck({
        cards: cardsOfLength(2),
        config,
        random: createSeededRandom({ seed: 1n }),
      }),
      {
        items: [{ kind: "new", card: { key: "inserted", matches: "yes" }, instanceId: "inserted" }],
        placement: { kind: "random-within", startGap: 0, endGap: 2 },
      },
    ).deck;
    expect(
      probabilityAtDraw(inserted, { kind: "instance", instanceId: "inserted" }, 2).exact,
    ).toEqual({
      numerator: 1n,
      denominator: 3n,
    });

    const hiddenDraw = drawCards(
      shuffleDeck(
        createDeck({
          cards: cardsOfLength(4),
          config,
          random: createSeededRandom({ seed: 3n }),
        }),
      ).deck,
      { reveal: false },
    ).deck;
    expect(
      probabilityAtDraw(hiddenDraw, { kind: "instance", instanceId: "instance-1" }, 1).exact,
    ).toEqual({
      numerator: 1n,
      denominator: 4n,
    });
  });
});
