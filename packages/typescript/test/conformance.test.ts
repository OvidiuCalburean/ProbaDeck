import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";
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
  ProbaDeckError,
  serializeEventLog,
  serializeSnapshot,
  shuffleDeck,
  type CardCodec,
  type CardTarget,
  type Deck,
  type JsonObject,
  type JsonValue,
  type Placement,
  type RandomSource,
  type RandomStep,
} from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scenarioNames = [
  "bounds-and-audit.json",
  "duplicate-logical-cards.json",
  "hidden-random-insertion.json",
  "pcg32-golden-vector.json",
  "revealed-miss-conditioning.json",
  "shuffled-ten-card.json",
] as const;

function parseJson(path: string): JsonValue {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonValue(parsed)) {
    throw new TypeError(`${path} does not contain JSON data.`);
  }
  return parsed;
}

function portableJson(value: unknown): JsonValue {
  const parsed: unknown = JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      typeof entry === "bigint" ? entry.toString() : entry,
    ),
  );
  if (!isJsonValue(parsed)) {
    throw new TypeError("The value could not be converted to portable JSON.");
  }
  return parsed;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: JsonValue | undefined, field: string): JsonObject {
  if (!isObject(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function array(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array.`);
  }
  return value;
}

function string(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string.`);
  }
  return value;
}

function number(value: JsonValue | undefined, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`${field} must be a number.`);
  }
  return value;
}

function boolean(value: JsonValue | undefined, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be a boolean.`);
  }
  return value;
}

function pointer(value: JsonValue, path: string): JsonValue {
  let current = value;
  for (const rawSegment of path.slice(1).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    const record = object(current, `pointer ${path}`);
    const next = record[segment];
    if (next === undefined) {
      throw new TypeError(`Pointer ${path} did not resolve.`);
    }
    current = next;
  }
  return current;
}

class EntropyTape implements RandomSource {
  readonly algorithm = "entropy-tape-v1";
  readonly #words: readonly number[];
  readonly #index: number;

  constructor(words: readonly number[], index = 0) {
    this.#words = words;
    this.#index = index;
    Object.freeze(this);
  }

  nextUint32(): RandomStep {
    const value = this.#words[this.#index];
    if (value === undefined) {
      throw new Error("Entropy tape exhausted.");
    }
    return Object.freeze({ value, next: new EntropyTape(this.#words, this.#index + 1) });
  }
}

function target(value: JsonValue | undefined): CardTarget {
  const record = object(value, "target");
  if (record.kind === "instance") {
    return { kind: record.kind, instanceId: string(record.instanceId, "target.instanceId") };
  }
  if (record.kind === "card-key") {
    return { kind: record.kind, cardKey: string(record.cardKey, "target.cardKey") };
  }
  if (record.kind === "classifier") {
    return {
      kind: record.kind,
      classifier: string(record.classifier, "target.classifier"),
      value: string(record.value, "target.value"),
    };
  }
  throw new TypeError("Conformance runner only received an unsupported target kind.");
}

function placement(value: JsonValue | undefined): Placement {
  const record = object(value, "placement");
  if (record.kind === "index") {
    return { kind: record.kind, index: number(record.index, "placement.index") };
  }
  if (record.kind === "random-within") {
    return {
      kind: record.kind,
      startGap: number(record.startGap, "placement.startGap"),
      endGap: number(record.endGap, "placement.endGap"),
    };
  }
  if (record.kind === "from-top" || record.kind === "from-bottom") {
    return {
      kind: record.kind,
      offset: number(record.offset, "placement.offset"),
    };
  }
  throw new TypeError("Conformance runner received an unsupported placement kind.");
}

function isJsonSubset(actual: unknown, expected: JsonValue): boolean {
  if (!isObject(expected)) {
    return isDeepStrictEqual(actual, expected);
  }
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) =>
    isJsonSubset(Reflect.get(actual, key), value),
  );
}

function assertJsonSubset(actual: unknown, value: JsonValue | undefined, field: string): void {
  if (value !== undefined && !isJsonSubset(actual, object(value, field))) {
    throw new Error(`${field} did not match the operation result.`);
  }
}

function assertJsonEqual(actual: unknown, expected: JsonValue, field: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${field} did not match: ${JSON.stringify(actual)}.`);
  }
}

function expectFraction(
  command: JsonObject,
  result: { readonly exact: { readonly numerator: bigint; readonly denominator: bigint } },
): void {
  const expected = object(command.expect, "expect");
  const expectedNumerator = string(expected.numerator, "expect.numerator");
  const expectedDenominator = string(expected.denominator, "expect.denominator");
  if (
    result.exact.numerator.toString() !== expectedNumerator ||
    result.exact.denominator.toString() !== expectedDenominator
  ) {
    throw new Error(
      `Expected ${expectedNumerator}/${expectedDenominator}, received ${result.exact.numerator}/${result.exact.denominator}.`,
    );
  }
}

function buildDeck(fixture: JsonObject): Deck<JsonValue> {
  const definition = object(fixture.definition, "definition");
  const cardKeyPointer = string(definition.cardKey, "definition.cardKey");
  const classifiersDefinition =
    definition.classifiers === undefined ? {} : object(definition.classifiers, "classifiers");
  const classifiers: Record<string, (card: JsonValue) => string> = {};
  for (const [name, rawPointer] of Object.entries(classifiersDefinition)) {
    const classifierPointer = string(rawPointer, `classifiers.${name}`);
    classifiers[name] = (card) => string(pointer(card, classifierPointer), classifierPointer);
  }
  const cardEntries = array(fixture.cards, "cards").map((entry) => object(entry, "card"));
  const cards = cardEntries.map((entry) => {
    const card = entry.card;
    if (card === undefined) {
      throw new TypeError("Fixture card is missing card data.");
    }
    return card;
  });
  const instanceIds = cardEntries.map((entry) => string(entry.instanceId, "instanceId"));
  const tapeWords = array(fixture.commands, "commands").flatMap((raw) => {
    const command = object(raw, "command");
    return command.entropy === undefined
      ? []
      : array(command.entropy, "entropy").map((word) => number(word, "entropy word"));
  });
  const random =
    fixture.seed === undefined
      ? tapeWords.length === 0
        ? undefined
        : new EntropyTape(tapeWords)
      : createSeededRandom({ seed: string(fixture.seed, "seed") });
  const options = {
    cards,
    instanceIds,
    config: {
      cardKey: (card: JsonValue) => string(pointer(card, cardKeyPointer), cardKeyPointer),
      classifiers,
    },
    ...(random === undefined ? {} : { random }),
  };
  return createDeck(options);
}

function runFixture(fixture: JsonObject): void {
  let deck = buildDeck(fixture);
  for (const raw of array(fixture.commands, "commands")) {
    const command = object(raw, "command");
    const kind = string(command.kind, "command.kind");
    if (kind === "pcg32-vector") {
      let random = createSeededRandom({
        seed: string(fixture.seed, "seed"),
        stream: string(command.stream, "stream"),
      });
      const words = array(command.expect, "expect").map(() => {
        const step = random.nextUint32();
        random = step.next;
        return step.value;
      });
      if (JSON.stringify(words) !== JSON.stringify(array(command.expect, "expect"))) {
        throw new Error("PCG32 golden vector did not match.");
      }
      continue;
    }
    if (kind === "shuffle" || kind === "shuffle-with-entropy-tape") {
      const region =
        command.region === undefined
          ? undefined
          : {
              startIndex: number(object(command.region, "region").startIndex, "startIndex"),
              endIndexExclusive: number(
                object(command.region, "region").endIndexExclusive,
                "endIndexExclusive",
              ),
            };
      const operation = shuffleDeck(deck, {
        visibility: command.visibility === "revealed" ? "revealed" : "hidden",
        bounds: command.bounds === "clamp" ? "clamp" : "error",
        ...(region === undefined ? {} : { region }),
      });
      deck = operation.deck;
      if (command.expectAppliedOrder !== undefined) {
        assertJsonEqual(
          getActiveCards(deck).map((instance) => instance.instanceId),
          array(command.expectAppliedOrder, "expectAppliedOrder"),
          "expectAppliedOrder",
        );
      }
      assertJsonSubset(
        operation.event.observation.details,
        command.expectObserver,
        "expectObserver",
      );
      continue;
    }
    if (kind === "probability-at-draw") {
      expectFraction(
        command,
        probabilityAtDraw(deck, target(command.target), number(command.drawNumber, "drawNumber")),
      );
      continue;
    }
    if (kind === "probability-within-draws") {
      expectFraction(
        command,
        probabilityWithinDraws(
          deck,
          target(command.target),
          number(command.drawCount, "drawCount"),
        ),
      );
      continue;
    }
    if (kind === "probability-next") {
      expectFraction(command, probabilityOfNext(deck, target(command.target)));
      continue;
    }
    if (kind === "draw") {
      const operation = drawCards(deck, {
        count: number(command.count, "count"),
        reveal: boolean(command.reveal, "reveal"),
      });
      deck = operation.deck;
      assertJsonEqual(
        operation.output.instances.map((instance) => instance.instanceId),
        array(command.expectInstanceIds, "expectInstanceIds"),
        "expectInstanceIds",
      );
      assertJsonSubset(
        operation.event.observation.details,
        command.expectObserver,
        "expectObserver",
      );
      continue;
    }
    if (kind === "insert") {
      const items = array(command.items, "items").map((rawItem) => {
        const item = object(rawItem, "item");
        if (item.kind === "drawn") {
          return {
            kind: item.kind,
            instanceId: string(item.instanceId, "item.instanceId"),
          } as const;
        }
        const card = item.card;
        if (item.kind !== "new" || card === undefined) {
          throw new TypeError("Fixture runner received an unsupported insertion item.");
        }
        return {
          kind: item.kind,
          instanceId: string(item.instanceId, "item.instanceId"),
          card,
        } as const;
      });
      const operation = () =>
        insertCards(deck, {
          items,
          placement: placement(command.placement),
          bounds: command.bounds === "clamp" ? "clamp" : "error",
          order: command.order === "random" ? "random" : "preserve",
          visibility: command.visibility === "revealed" ? "revealed" : "hidden",
        });
      if (command.expectError !== undefined) {
        const priorRevision = deck.revision;
        try {
          operation();
          throw new Error("Expected fixture operation to fail.");
        } catch (error) {
          if (!(error instanceof ProbaDeckError) || error.code !== command.expectError) {
            throw error;
          }
        }
        if (deck.revision !== priorRevision) {
          throw new Error("A failed fixture operation changed the revision.");
        }
        if (
          command.expectRevision !== undefined &&
          deck.revision !== number(command.expectRevision, "expectRevision")
        ) {
          throw new Error("The failed fixture operation has the wrong revision.");
        }
      } else {
        const result = operation();
        deck = result.deck;
        assertJsonSubset(result.output, command.expect, "expect");
        assertJsonSubset(
          result.event.observation.details,
          command.expectObserver,
          "expectObserver",
        );
      }
      continue;
    }
    throw new TypeError(`Unsupported conformance command '${kind}'.`);
  }
}

describe("language-independent conformance fixtures", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const schemaName of [
    "common-v1.schema.json",
    "snapshot-v1.schema.json",
    "event-log-v1.schema.json",
  ]) {
    ajv.addSchema(object(parseJson(`${repositoryRoot}spec/schema/${schemaName}`), schemaName));
  }
  const validate = ajv.compile(
    object(
      parseJson(`${repositoryRoot}spec/schema/conformance-v1.schema.json`),
      "conformance schema",
    ),
  );

  it("validates runtime snapshots, event logs, and explanations against the portable schemas", () => {
    const codec: CardCodec<JsonValue> = {
      encode: (card) => card,
      decode: (value) => value,
    };
    const cards: readonly JsonValue[] = [{ name: "target" }, { name: "other" }];
    const deck = shuffleDeck(
      createDeck({
        cards,
        config: { cardKey: (card) => string(object(card, "card").name, "card.name") },
        random: createSeededRandom({ seed: 12n }),
      }),
    ).deck;
    const probability = probabilityWithinDraws(deck, { kind: "card-key", cardKey: "target" }, 1);
    const validateSnapshot = ajv.getSchema("https://probadeck.dev/schema/snapshot-v1.schema.json");
    const validateEventLog = ajv.getSchema("https://probadeck.dev/schema/event-log-v1.schema.json");
    const validateExplanation = ajv.compile({
      $ref: "https://probadeck.dev/schema/common-v1.schema.json#/$defs/probabilityExplanation",
    });

    expect(validateSnapshot?.(serializeSnapshot(deck, codec))).toBe(true);
    expect(validateEventLog?.(serializeEventLog(deck, codec))).toBe(true);
    expect(validateExplanation(portableJson(probability.explanation))).toBe(true);
  });

  for (const scenarioName of scenarioNames) {
    it(`validates and executes ${scenarioName}`, () => {
      const fixture = parseJson(`${repositoryRoot}conformance/scenarios/${scenarioName}`);
      expect(validate(fixture)).toBe(true);
      runFixture(object(fixture, scenarioName));
    });
  }
});
