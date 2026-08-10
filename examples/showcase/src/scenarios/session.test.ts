import { describe, expect, it } from "vitest";

import {
  applyScenarioAction,
  createScenarioSession,
  getPrivilegedOrder,
  getProbabilityView,
  normalizeQuery,
} from "./session.js";

describe("showcase scenarios", () => {
  it("deals five Texas Hold'em cards and changes the deal with a new seed", () => {
    const first = createScenarioSession("holdem", 42n);
    const second = createScenarioSession("holdem", 43n);

    expect(first.deck.length).toBe(47);
    expect(first.zones.hand).toHaveLength(2);
    expect(first.zones.community).toHaveLength(3);
    expect(second.deck.length).toBe(47);

    expect(
      [...second.zones.hand, ...second.zones.community].map((card) => card.card.name),
    ).not.toEqual([...first.zones.hand, ...first.zones.community].map((card) => card.card.name));
  });

  it("caps the Texas Hold'em community at five cards", () => {
    const flop = createScenarioSession("holdem", 7n);
    const turn = applyScenarioAction(flop, { kind: "draw" });
    const river = applyScenarioAction(turn, { kind: "draw" });

    expect(river.zones.community).toHaveLength(5);
    expect(river.deck.length).toBe(45);
    expect(() => applyScenarioAction(river, { kind: "draw" })).toThrow(
      "community cards are capped at five",
    );
  });

  it("tracks the exact land classifier for the Pro Tour-winning Magic deck", () => {
    const session = createScenarioSession("magic", 42n);
    const view = getProbabilityView(session, { kind: "next" });
    const visibleLands = session.zones.hand.filter(
      (instance) => instance.card.category === "Land",
    ).length;
    const remainingLands = 25 - visibleLands;

    expect(session.deck.length).toBe(53);
    expect(session.zones.hand).toHaveLength(7);
    const classifier = view.classifier;
    expect(classifier).not.toBeNull();
    if (classifier === null) return;
    expect(classifier.exact.numerator * 53n).toBe(
      classifier.exact.denominator * BigInt(remainingLands),
    );
  });

  it("returns a revealed Magic card to the top, then hides it in a new shuffle", () => {
    const session = createScenarioSession("magic", 99n);
    const returned = session.zones.hand[0];
    expect(returned).toBeDefined();
    if (returned === undefined) return;

    const inserted = applyScenarioAction(session, {
      kind: "return-card",
      instanceId: returned.instanceId,
      placement: { kind: "top" },
    });
    const insertedRow = getProbabilityView(inserted, { kind: "next" }).rows.find(
      (row) => row.card.name === returned.card.name,
    );

    expect(inserted.deck.length).toBe(54);
    expect(inserted.zones.hand).toHaveLength(6);
    expect(insertedRow?.exact).toEqual({ numerator: 1n, denominator: 1n });

    const shuffled = applyScenarioAction(inserted, { kind: "shuffle" });
    const shuffledRow = getProbabilityView(shuffled, { kind: "next" }).rows.find(
      (row) => row.card.name === returned.card.name,
    );
    expect(shuffledRow?.exact.denominator).toBeGreaterThan(1n);
  });

  it("uses the 40-card WCQ-winning Yu-Gi-Oh! list and supports 1-based positions", () => {
    const session = createScenarioSession("yugioh", 42n);
    const returned = session.zones.hand.at(-1);
    expect(returned).toBeDefined();
    if (returned === undefined) return;

    const first = applyScenarioAction(session, {
      kind: "return-card",
      instanceId: returned.instanceId,
      placement: { kind: "position", position: 1 },
    });
    const second = applyScenarioAction(session, {
      kind: "return-card",
      instanceId: returned.instanceId,
      placement: { kind: "position", position: 2 },
    });

    expect(session.definition.catalog.reduce((sum, card) => sum + card.count, 0)).toBe(40);
    expect(session.deck.length).toBe(35);
    expect(first.deck.length).toBe(36);
    expect(first.zones.hand).toHaveLength(4);
    expect(getPrivilegedOrder(first)[0]?.instanceId).toBe(returned.instanceId);
    expect(getPrivilegedOrder(second)[1]?.instanceId).toBe(returned.instanceId);
    expect(second.events.at(-1)?.detail).toContain("position 2 from the top");
  });

  it("replays the same opening hand for the same seed and clamps relative queries", () => {
    const first = createScenarioSession("magic", 1234n);
    const second = createScenarioSession("magic", 1234n);

    expect(first.zones.hand.map((card) => card.card.name)).toEqual(
      second.zones.hand.map((card) => card.card.name),
    );
    expect(normalizeQuery(5, { kind: "at-draw", drawNumber: 99 })).toEqual({
      kind: "at-draw",
      drawNumber: 5,
    });
    expect(normalizeQuery(5, { kind: "within-draws", drawCount: 99 })).toEqual({
      kind: "within-draws",
      drawCount: 5,
    });
  });
});
