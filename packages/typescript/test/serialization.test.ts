import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  getActiveCards,
  probabilityWithinDraws,
  ProbaDeckError,
  type ProbaDeckErrorCode,
  restoreSnapshot,
  serializeSnapshot,
  shuffleDeck,
  type CardCodec,
  type JsonValue,
} from "../src/index.js";

interface StoredCard {
  readonly name: string;
  readonly group: string;
}

const config = {
  cardKey: (card: StoredCard) => card.name,
  classifiers: { group: (card: StoredCard) => card.group },
};

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonArray(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array.`);
  }
  return value;
}

function jsonObject(
  value: JsonValue | undefined,
  field: string,
): Readonly<Record<string, JsonValue>> {
  if (value === undefined || !isRecord(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function expectRestoreCode(
  value: JsonValue,
  code: ProbaDeckErrorCode,
  selectedCodec: CardCodec<StoredCard> = codec,
): void {
  try {
    restoreSnapshot(value, { config, codec: selectedCodec });
    throw new Error(`Expected restore to fail with ${code}.`);
  } catch (error) {
    if (!(error instanceof ProbaDeckError) || error.code !== code) {
      throw error;
    }
  }
}

const codec: CardCodec<StoredCard> = {
  encode: (card) => ({ name: card.name, group: card.group }),
  decode: (value) => {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.group !== "string") {
      throw new TypeError("Invalid stored card.");
    }
    return { name: value.name, group: value.group };
  },
};

describe("snapshot persistence", () => {
  it("round trips concrete state, exact knowledge, events, and PCG continuation", () => {
    const initial = createDeck({
      cards: [
        { name: "a", group: "target" },
        { name: "b", group: "other" },
        { name: "c", group: "other" },
      ],
      config,
      random: createSeededRandom({ seed: 72n }),
    });
    const shuffled = shuffleDeck(initial).deck;
    const snapshot = serializeSnapshot(shuffled, codec);
    const restored = restoreSnapshot(snapshot, { config, codec });

    expect(getActiveCards(restored)).toEqual(getActiveCards(shuffled));
    expect(restored.revision).toBe(shuffled.revision);
    expect(
      probabilityWithinDraws(
        restored,
        { kind: "classifier", classifier: "group", value: "target" },
        2,
      ).exact,
    ).toEqual({ numerator: 2n, denominator: 3n });
    expect(getActiveCards(shuffleDeck(restored).deck)).toEqual(
      getActiveCards(shuffleDeck(shuffled).deck),
    );
  });

  it("rejects unsupported versions, malformed cards, and metadata drift", () => {
    const initial = createDeck({ cards: [{ name: "a", group: "target" }], config });
    const snapshot = serializeSnapshot(initial, codec);
    const wrongVersion: JsonValue = { ...snapshot, schemaVersion: "probadeck.snapshot/v2" };
    expect(() => restoreSnapshot(wrongVersion, { config, codec })).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA_VERSION" }),
    );

    const badCodec: CardCodec<StoredCard> = {
      ...codec,
      decode: () => ({ name: "changed", group: "target" }),
    };
    expect(() => restoreSnapshot(snapshot, { config, codec: badCodec })).toThrowError(
      expect.objectContaining({ code: "CARD_METADATA_MISMATCH" }),
    );

    const malformed: JsonValue = { ...snapshot, instances: [{ card: false }] };
    expect(() => restoreSnapshot(malformed, { config, codec })).toThrowError(ProbaDeckError);
  });

  it("rejects codec failures and every malformed snapshot boundary", () => {
    const initial = createDeck({ cards: [{ name: "a", group: "target" }], config });
    const snapshot = serializeSnapshot(initial, codec);
    const instances = jsonArray(snapshot.instances, "instances");
    const firstInstance = jsonObject(instances[0], "first instance");
    const knowledge = jsonArray(snapshot.knowledge, "knowledge");
    const firstHypothesis = jsonObject(knowledge[0], "first hypothesis");
    const cells = jsonArray(firstHypothesis.active, "active cells");
    const firstCell = jsonObject(cells[0], "first cell");
    const events = jsonArray(snapshot.events, "events");
    const firstEvent = jsonObject(events[0], "first event");
    const observation = jsonObject(firstEvent.observation, "observation");

    expect(() =>
      serializeSnapshot(initial, {
        ...codec,
        encode: () => {
          throw new Error("encode");
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SERIALIZED_DATA" }));
    expect(() => serializeSnapshot(initial, { ...codec, encode: () => Number.NaN })).toThrowError(
      expect.objectContaining({ code: "INVALID_SERIALIZED_DATA" }),
    );
    const cyclic: Record<string, JsonValue> = {};
    cyclic.self = cyclic;
    expect(() => serializeSnapshot(initial, { ...codec, encode: () => cyclic })).toThrowError(
      expect.objectContaining({ code: "INVALID_SERIALIZED_DATA" }),
    );
    for (const encoded of [null, "card", true, 1, [null], {}] satisfies readonly JsonValue[]) {
      expect(
        serializeSnapshot(initial, { ...codec, encode: () => encoded }).instances,
      ).toHaveLength(1);
    }

    expectRestoreCode(false, "INVALID_SERIALIZED_DATA");
    expectRestoreCode({ ...snapshot, instances: false }, "INVALID_SERIALIZED_DATA");
    expectRestoreCode(
      { ...snapshot, instances: [{ ...firstInstance, instanceId: false }] },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode({ ...snapshot, revision: -1 }, "INVALID_SERIALIZED_DATA");
    expectRestoreCode(
      { ...snapshot, instances: [firstInstance, firstInstance] },
      "INVALID_SERIALIZED_DATA",
    );
    const instanceWithoutCard = { ...firstInstance };
    delete instanceWithoutCard.card;
    expectRestoreCode({ ...snapshot, instances: [instanceWithoutCard] }, "INVALID_SERIALIZED_DATA");
    expectRestoreCode(snapshot, "INVALID_SERIALIZED_DATA", {
      ...codec,
      decode: () => {
        throw new Error("decode");
      },
    });
    expectRestoreCode(
      {
        ...snapshot,
        knowledge: [{ ...firstHypothesis, active: [{ ...firstCell, kind: "unknown" }] }],
      },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode(
      {
        ...snapshot,
        knowledge: [
          {
            ...firstHypothesis,
            weight: { numerator: "not-an-integer", denominator: "1" },
          },
        ],
      },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode(
      {
        ...snapshot,
        events: [
          {
            ...firstEvent,
            observation: { ...observation, schemaVersion: 2 },
          },
        ],
      },
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    expectRestoreCode(
      { ...snapshot, events: [{ ...firstEvent, schemaVersion: 2 }] },
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    expectRestoreCode(
      { ...snapshot, events: [{ ...firstEvent, sequence: 1 }] },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode(
      {
        ...snapshot,
        events: [
          {
            ...firstEvent,
            observation: { ...observation, kind: "different" },
          },
        ],
      },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode({ ...snapshot, events: [] }, "INVALID_SERIALIZED_DATA");
    expectRestoreCode(
      {
        ...snapshot,
        events: [
          { ...firstEvent, kind: "different", observation: { ...observation, kind: "different" } },
        ],
      },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode(
      { ...snapshot, active: ["instance-1", "instance-1"] },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode({ ...snapshot, active: ["missing"] }, "INVALID_SERIALIZED_DATA");
    expectRestoreCode(
      { ...snapshot, knowledge: [{ ...firstHypothesis, active: [] }] },
      "INVALID_SERIALIZED_DATA",
    );
    expectRestoreCode({ ...snapshot, revision: 1 }, "INVALID_SERIALIZED_DATA");

    const shuffledSnapshot = serializeSnapshot(
      shuffleDeck(
        createDeck({
          cards: [
            { name: "a", group: "target" },
            { name: "b", group: "other" },
          ],
          config,
          random: createSeededRandom({ seed: 2n }),
        }),
      ).deck,
      codec,
    );
    const shuffledKnowledge = jsonArray(shuffledSnapshot.knowledge, "shuffled knowledge");
    const shuffledHypothesis = jsonObject(shuffledKnowledge[0], "shuffled hypothesis");
    const pools = jsonArray(shuffledHypothesis.pools, "pools");
    const firstPool = jsonObject(pools[0], "first pool");
    expectRestoreCode(
      {
        ...shuffledSnapshot,
        knowledge: [{ ...shuffledHypothesis, pools: [firstPool, firstPool] }],
      },
      "INVALID_SERIALIZED_DATA",
    );
  });

  it("serializes custom random metadata and restores a supplied replacement", () => {
    const replacement = createSeededRandom({ seed: 8n });
    const custom = {
      algorithm: "custom-v1",
      nextUint32: () => ({ value: 1, next: custom }),
    };
    const deck = createDeck({
      cards: [{ name: "a", group: "target" }],
      config,
      random: custom,
    });
    const snapshot = serializeSnapshot(deck, codec);
    expect(snapshot).toMatchObject({ random: null, randomAlgorithm: "custom-v1" });
    const restored = restoreSnapshot(snapshot, { config, codec, random: replacement });
    expect(getActiveCards(shuffleDeck(restored).deck)).toEqual(getActiveCards(restored));
  });
});
