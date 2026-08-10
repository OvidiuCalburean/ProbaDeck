import fc from "fast-check";
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
  type JsonValue,
  type Placement,
  type ProbabilityResult,
} from "../src/index.js";

interface StressCard {
  readonly logicalKey: string;
  readonly groups: readonly string[];
  readonly payload: number;
}

type StressCommand =
  | {
      readonly kind: "shuffle";
      readonly rawA: number;
      readonly rawB: number;
      readonly revealed: boolean;
    }
  | {
      readonly kind: "draw";
      readonly rawA: number;
      readonly revealed: boolean;
    }
  | {
      readonly kind: "return";
      readonly rawA: number;
      readonly rawB: number;
      readonly rawC: number;
      readonly revealed: boolean;
    }
  | {
      readonly kind: "insert-new";
      readonly rawA: number;
      readonly rawB: number;
      readonly rawC: number;
      readonly revealed: boolean;
    }
  | {
      readonly kind: "move";
      readonly rawA: number;
      readonly rawB: number;
      readonly rawC: number;
      readonly useTwo: boolean;
      readonly revealed: boolean;
    }
  | {
      readonly kind: "observe";
      readonly rawA: number;
      readonly preferDrawn: boolean;
    }
  | {
      readonly kind: "query";
      readonly rawA: number;
      readonly rawB: number;
    };

interface StressScenario {
  readonly cards: readonly StressCard[];
  readonly seed: number;
  readonly commands: readonly StressCommand[];
}

const config = {
  cardKey: (card: StressCard) => card.logicalKey,
  classifiers: {
    group: (card: StressCard) => card.groups,
    parity: (card: StressCard) => (card.payload % 2 === 0 ? "even" : "odd"),
  },
};

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const codec: CardCodec<StressCard> = {
  encode: (card) => ({
    logicalKey: card.logicalKey,
    groups: card.groups,
    payload: card.payload,
  }),
  decode: (value) => {
    if (
      !isRecord(value) ||
      typeof value.logicalKey !== "string" ||
      !Array.isArray(value.groups) ||
      !value.groups.every((group) => typeof group === "string") ||
      typeof value.payload !== "number" ||
      !Number.isSafeInteger(value.payload)
    ) {
      throw new TypeError("Invalid stress-test card.");
    }
    return {
      logicalKey: value.logicalKey,
      groups: value.groups,
      payload: value.payload,
    };
  },
};

function positiveEnvironmentInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

const stressRuns = positiveEnvironmentInteger("PROBADECK_STRESS_RUNS", 25, 100_000);
const stressCommandCount = positiveEnvironmentInteger("PROBADECK_STRESS_COMMANDS", 35, 500);

function stressParameters(): {
  readonly numRuns: number;
  readonly seed?: number;
  readonly path?: string;
} {
  const parameters: { numRuns: number; seed?: number; path?: string } = { numRuns: stressRuns };
  const seed = Number.parseInt(process.env.PROBADECK_STRESS_SEED ?? "", 10);
  const path = process.env.PROBADECK_STRESS_PATH;
  if (Number.isSafeInteger(seed)) {
    parameters.seed = seed;
  }
  if (path !== undefined && path.length > 0) {
    parameters.path = path;
  }
  return parameters;
}

const raw = fc.nat({ max: 1_000_000 });

const commandArbitrary: fc.Arbitrary<StressCommand> = fc.oneof(
  fc.record({
    kind: fc.constant("shuffle" as const),
    rawA: raw,
    rawB: raw,
    revealed: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("draw" as const), rawA: raw, revealed: fc.boolean() }),
  fc.record({
    kind: fc.constant("return" as const),
    rawA: raw,
    rawB: raw,
    rawC: raw,
    revealed: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("insert-new" as const),
    rawA: raw,
    rawB: raw,
    rawC: raw,
    revealed: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("move" as const),
    rawA: raw,
    rawB: raw,
    rawC: raw,
    useTwo: fc.boolean(),
    revealed: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("observe" as const),
    rawA: raw,
    preferDrawn: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("query" as const), rawA: raw, rawB: raw }),
);

const cardArbitrary: fc.Arbitrary<StressCard> = fc
  .record({
    logicalKey: fc.integer({ min: 0, max: 7 }),
    groups: fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 3 }),
    payload: fc.integer({ min: -10_000, max: 10_000 }),
  })
  .map((card) => ({
    logicalKey: `key-${card.logicalKey}`,
    groups: card.groups.map((group) => `group-${group}`),
    payload: card.payload,
  }));

const scenarioArbitrary: fc.Arbitrary<StressScenario> = fc.record({
  cards: fc.array(cardArbitrary, { minLength: 1, maxLength: 24 }),
  seed: fc.nat({ max: 0x7fff_ffff }),
  commands: fc.array(commandArbitrary, { minLength: 1, maxLength: stressCommandCount }),
});

function placement(rawA: number, rawB: number, referenceLength: number): Placement {
  const gap = rawB % (referenceLength + 1);
  switch (rawA % 4) {
    case 0:
      return { kind: "index", index: gap };
    case 1:
      return { kind: "from-top", offset: gap };
    case 2:
      return { kind: "from-bottom", offset: gap };
    default: {
      const startGap = rawB % (referenceLength + 1);
      const endGap = startGap + (rawA % (referenceLength - startGap + 1));
      return { kind: "random-within", startGap, endGap };
    }
  }
}

function probabilityTarget(deck: Deck<StressCard>, selector: number): CardTarget {
  const instances = [...getActiveCards(deck), ...getDrawnCards(deck)];
  const selected = instances[selector % instances.length];
  if (selected === undefined) {
    return { kind: "classifier", classifier: "group", value: "group-0" };
  }
  switch (selector % 5) {
    case 0:
      return { kind: "instance", instanceId: selected.instanceId };
    case 1:
      return { kind: "card-key", cardKey: selected.cardKey };
    case 2:
      return { kind: "classifier", classifier: "group", value: selected.card.groups[0] ?? "" };
    case 3:
      return {
        kind: "any",
        targets: [
          { kind: "instance", instanceId: selected.instanceId },
          { kind: "classifier", classifier: "parity", value: "even" },
        ],
      };
    default:
      return {
        kind: "not",
        target: { kind: "classifier", classifier: "parity", value: "odd" },
      };
  }
}

function expectValidProbability(result: ProbabilityResult): void {
  expect(result.exact.denominator).toBeGreaterThan(0n);
  expect(result.exact.numerator).toBeGreaterThanOrEqual(0n);
  expect(result.exact.numerator).toBeLessThanOrEqual(result.exact.denominator);
  expect(result.decimal).toBeGreaterThanOrEqual(0);
  expect(result.decimal).toBeLessThanOrEqual(1);
  expect(result.explanation.result).toEqual(result.exact);
}

function sortedStrings(values: readonly string[]): readonly string[] {
  const copy = [...values];
  // eslint-disable-next-line unicorn/no-array-sort -- The package's public runtime target is ES2022.
  return copy.sort((left, right) => left.localeCompare(right));
}

function expectDeckInvariants(deck: Deck<StressCard>, expectedIds: ReadonlySet<string>): void {
  const active = getActiveCards(deck);
  const drawn = getDrawnCards(deck);
  const instanceIds = [...active, ...drawn].map((instance) => instance.instanceId);
  const auditLog = getAuditLog(deck);
  const observerLog = getObserverLog(deck);
  const sequences = Array.from({ length: deck.revision + 1 }, (_value, index) => index);

  expect(active).toHaveLength(deck.length);
  expect(drawn).toHaveLength(deck.drawnCount);
  expect(instanceIds).toHaveLength(expectedIds.size);
  expect(new Set(instanceIds).size).toBe(instanceIds.length);
  expect(sortedStrings(instanceIds)).toEqual(sortedStrings([...expectedIds]));
  expect(auditLog.map((event) => event.sequence)).toEqual(sequences);
  expect(observerLog.map((event) => event.sequence)).toEqual(sequences);
  expect(auditLog.map((event) => event.revision)).toEqual(sequences);
  expect(Object.isFrozen(active)).toBe(true);
  expect(Object.isFrozen(drawn)).toBe(true);

  if (deck.length > 0) {
    expectValidProbability(
      probabilityOfNext(deck, { kind: "classifier", classifier: "group", value: "group-0" }),
    );
  }
}

function applyCommand(
  deck: Deck<StressCard>,
  command: StressCommand,
  step: number,
): { readonly deck: Deck<StressCard>; readonly insertedId?: string } {
  switch (command.kind) {
    case "shuffle": {
      if (deck.length === 0) return { deck };
      const startIndex = command.rawA % deck.length;
      const available = Math.min(4, deck.length - startIndex);
      const endIndexExclusive = startIndex + 1 + (command.rawB % available);
      return {
        deck: shuffleDeck(deck, {
          region: { startIndex, endIndexExclusive },
          visibility: command.revealed ? "revealed" : "hidden",
        }).deck,
      };
    }

    case "draw": {
      if (deck.length === 0) return { deck };
      const count = 1 + (command.rawA % Math.min(3, deck.length));
      return { deck: drawCards(deck, { count, reveal: command.revealed }).deck };
    }

    case "return": {
      const drawn = getDrawnCards(deck);
      const instance = drawn[command.rawA % drawn.length];
      if (instance === undefined) return { deck };
      return {
        deck: insertCards(deck, {
          items: [{ kind: "drawn", instanceId: instance.instanceId }],
          placement: placement(command.rawB, command.rawC, deck.length),
          visibility: command.revealed ? "revealed" : "hidden",
        }).deck,
      };
    }

    case "insert-new": {
      if (deck.length + deck.drawnCount >= 40) return { deck };
      const insertedId = `stress-new-${step}`;
      const card: StressCard = {
        logicalKey: `new-key-${command.rawA % 5}`,
        groups: [`group-${command.rawB % 6}`, `step-${step % 3}`],
        payload: command.rawC,
      };
      return {
        deck: insertCards(deck, {
          items: [{ kind: "new", card, instanceId: insertedId }],
          placement: placement(command.rawA, command.rawB, deck.length),
          visibility: command.revealed ? "revealed" : "hidden",
        }).deck,
        insertedId,
      };
    }

    case "move": {
      if (deck.length === 0) return { deck };
      const firstIndex = command.rawA % deck.length;
      const indices = [firstIndex];
      if (command.useTwo && deck.length > 1) {
        indices.push((firstIndex + 1 + (command.rawB % (deck.length - 1))) % deck.length);
      }
      const referenceLength = deck.length - indices.length;
      return {
        deck: moveCards(deck, {
          selection: { kind: "indices", indices },
          placement: placement(command.rawB, command.rawC, referenceLength),
          order: indices.length > 1 && command.rawA % 2 === 0 ? "random" : "preserve",
          visibility: command.revealed ? "revealed" : "hidden",
        }).deck,
      };
    }

    case "observe": {
      const drawn = getDrawnCards(deck);
      const active = getActiveCards(deck);
      const useDrawn = command.preferDrawn && drawn.length > 0;
      const zone = useDrawn ? "drawn" : "active";
      const instances = useDrawn ? drawn : active;
      const index = command.rawA % instances.length;
      const instance = instances[index];
      if (instance === undefined) return { deck };
      return {
        deck: observe(deck, {
          location: { zone, index },
          evidence: { kind: "instance", instanceId: instance.instanceId },
        }).deck,
      };
    }

    case "query": {
      if (deck.length === 0) return { deck };
      const target = probabilityTarget(deck, command.rawA);
      const drawNumber = 1 + (command.rawB % deck.length);
      expectValidProbability(probabilityOfNext(deck, target));
      expectValidProbability(probabilityAtDraw(deck, target, drawNumber));
      expectValidProbability(
        probabilityWithinDraws(deck, target, command.rawB % (deck.length + 1)),
      );
      return { deck };
    }
    default: {
      const exhaustiveCommand: never = command;
      throw new Error(`Unsupported stress command: ${String(exhaustiveCommand)}`);
    }
  }
}

function executeScenario(scenario: StressScenario): JsonValue {
  let deck = createDeck({
    cards: scenario.cards,
    config,
    random: createSeededRandom({ seed: BigInt(scenario.seed) }),
    maxHypotheses: 512,
  });
  const expectedIds = new Set(
    scenario.cards.map((_card, index) => `instance-${String(index + 1)}`),
  );
  expectDeckInvariants(deck, expectedIds);

  scenario.commands.forEach((command, step) => {
    const inputDeck = deck;
    const inputSnapshot = serializeSnapshot(inputDeck, codec);
    try {
      const result = applyCommand(inputDeck, command, step);
      deck = result.deck;
      if (result.insertedId !== undefined) {
        expectedIds.add(result.insertedId);
      }
    } catch (error) {
      if (!(error instanceof ProbaDeckError) || error.code !== "INFERENCE_LIMIT_EXCEEDED") {
        throw error;
      }
    }

    expect(serializeSnapshot(inputDeck, codec)).toEqual(inputSnapshot);
    expectDeckInvariants(deck, expectedIds);
  });

  const snapshot = serializeSnapshot(deck, codec);
  const restored = restoreSnapshot(snapshot, { config, codec });
  const eventLog = serializeEventLog(deck, codec);
  const replayed = replayEventLog(eventLog, { config, codec });

  expect(serializeSnapshot(restored, codec)).toEqual(snapshot);
  expect(serializeSnapshot(replayed, codec)).toEqual(snapshot);
  return eventLog;
}

describe("state-machine stress verification", () => {
  it(
    "preserves exact state across generated mixed-operation histories",
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(scenarioArbitrary, (scenario) => {
          const firstRun = executeScenario(scenario);
          const secondRun = executeScenario(scenario);
          expect(secondRun).toEqual(firstRun);
        }),
        stressParameters(),
      );
    },
  );
});
