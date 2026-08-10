import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  drawCards,
  getActiveCards,
  getDrawnCards,
  insertCards,
  moveCards,
  observe,
  probabilityOfNext,
  replayEventLog,
  serializeEventLog,
  shuffleDeck,
  type CardCodec,
  type JsonObject,
  type JsonValue,
  type ProbaDeckErrorCode,
} from "../src/index.js";

interface ReplayCard {
  readonly name: string;
  readonly group: string;
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const codec: CardCodec<ReplayCard> = {
  encode: (card) => ({ name: card.name, group: card.group }),
  decode: (value) => {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.group !== "string") {
      throw new TypeError("Invalid replay card.");
    }
    return { name: value.name, group: value.group };
  },
};

const config = {
  cardKey: (card: ReplayCard) => card.name,
  classifiers: { group: (card: ReplayCard) => card.group },
};

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

function replaceLogEvent(
  log: Readonly<Record<string, JsonValue>>,
  sequence: number,
  replacement: Readonly<Record<string, JsonValue>>,
): JsonObject {
  const snapshot = jsonObject(log.snapshot, "snapshot");
  const events = jsonArray(snapshot.events, "events");
  return {
    ...log,
    snapshot: {
      ...snapshot,
      events: events.map((event, index) => (index === sequence ? replacement : event)),
    },
  };
}

function alterLogEvent(
  log: Readonly<Record<string, JsonValue>>,
  sequence: number,
  section: "request" | "resolution",
  changes: Readonly<Record<string, JsonValue>>,
): JsonObject {
  const snapshot = jsonObject(log.snapshot, "snapshot");
  const events = jsonArray(snapshot.events, "events");
  const event = jsonObject(events[sequence], `events[${sequence}]`);
  const prior = jsonObject(event[section], section);
  return replaceLogEvent(log, sequence, { ...event, [section]: { ...prior, ...changes } });
}

function expectReplayCode(value: JsonValue, code: ProbaDeckErrorCode): void {
  try {
    replayEventLog(value, { config, codec });
    throw new Error(`Expected replay to fail with ${code}.`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== code) {
      throw error;
    }
  }
}

describe("event replay", () => {
  it("replays recorded resolutions without consuming a caller random source", () => {
    const created = createDeck({
      cards: [
        { name: "target", group: "target" },
        { name: "other-a", group: "other" },
        { name: "other-b", group: "other" },
      ],
      config,
      random: createSeededRandom({ seed: 100n }),
    });
    const shuffled = shuffleDeck(created).deck;
    const drawn = drawCards(shuffled).deck;
    const inserted = insertCards(drawn, {
      items: [{ kind: "new", card: { name: "new", group: "other" } }],
      placement: { kind: "random-within", startGap: 0, endGap: drawn.length },
    }).deck;
    const moved = moveCards(inserted, {
      selection: { kind: "indices", indices: [0, 2] },
      placement: { kind: "from-bottom", offset: 0 },
      visibility: "revealed",
    }).deck;
    const top = getActiveCards(moved)[0];
    if (top === undefined) {
      throw new Error("Expected a top card.");
    }
    const final = observe(moved, {
      location: { zone: "active", index: 0 },
      evidence: {
        kind: "target",
        target: { kind: "classifier", classifier: "group", value: top.card.group },
        matches: true,
      },
    }).deck;
    const log = serializeEventLog(final, codec);
    const throwingRandom = {
      algorithm: "must-not-run",
      nextUint32: () => {
        throw new Error("Replay consumed caller RNG.");
      },
    };
    const replayed = replayEventLog(log, { config, codec, random: throwingRandom });

    expect(getActiveCards(replayed)).toEqual(getActiveCards(final));
    expect(replayed.revision).toBe(final.revision);
    expect(probabilityOfNext(replayed, { kind: "card-key", cardKey: top.card.name }).exact).toEqual(
      probabilityOfNext(final, { kind: "card-key", cardKey: top.card.name }).exact,
    );
    expect(getActiveCards(shuffleDeck(replayed).deck)).toEqual(
      getActiveCards(shuffleDeck(final).deck),
    );

    const prefix = replayEventLog(log, { config, codec, throughSequence: 2 });
    expect(getActiveCards(prefix)).toEqual(getActiveCards(drawn));
    expect(prefix.revision).toBe(2);
  });

  it("rejects a tampered schema and an invalid replay prefix", () => {
    const deck = createDeck({ cards: [{ name: "a", group: "other" }], config });
    const log = serializeEventLog(deck, codec);
    expect(() =>
      replayEventLog({ ...log, schemaVersion: "probadeck.events/v2" }, { config, codec }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_SCHEMA_VERSION" }));
    expect(() => replayEventLog(log, { config, codec, throughSequence: 2 })).toThrowError(
      expect.objectContaining({ code: "INVALID_SERIALIZED_DATA" }),
    );
  });

  it("replays every visibility, selector, selection, placement, and order variant", () => {
    let deck = createDeck({
      cards: [
        { name: "target", group: "target" },
        { name: "other-a", group: "other" },
        { name: "other-b", group: "other" },
        { name: "other-c", group: "other" },
      ],
      config,
      random: createSeededRandom({ seed: 44n }),
    });
    deck = shuffleDeck(deck, { visibility: "revealed" }).deck;
    deck = drawCards(deck, { reveal: false }).deck;
    const drawnId = getDrawnCards(deck)[0]?.instanceId;
    if (drawnId === undefined) {
      throw new Error("Expected a drawn card.");
    }
    deck = insertCards(deck, {
      items: [{ kind: "drawn", instanceId: drawnId }],
      placement: { kind: "from-top", offset: 0 },
      visibility: "revealed",
    }).deck;
    deck = insertCards(deck, {
      items: [
        { kind: "new", card: { name: "new-a", group: "other" } },
        { kind: "new", card: { name: "new-b", group: "other" } },
      ],
      placement: { kind: "from-top", offset: 1 },
      order: "random",
    }).deck;
    const ids = getActiveCards(deck).map((instance) => instance.instanceId);
    const first = ids[0];
    const third = ids[2];
    if (first === undefined || third === undefined) {
      throw new Error("Expected move candidates.");
    }
    deck = moveCards(deck, {
      selection: { kind: "instances", instanceIds: [first, third] },
      placement: { kind: "from-bottom", offset: 0 },
      order: "random",
    }).deck;
    deck = moveCards(deck, {
      selection: { kind: "instances", instanceIds: [first] },
      placement: { kind: "index", index: 0 },
      visibility: "revealed",
    }).deck;
    deck = moveCards(deck, {
      selection: { kind: "indices", indices: [0, 1] },
      placement: { kind: "random-within", startGap: 0, endGap: deck.length - 2 },
    }).deck;
    deck = moveCards(deck, {
      selection: { kind: "indices", indices: [0] },
      placement: { kind: "index", index: 0 },
    }).deck;
    const top = getActiveCards(deck)[0];
    if (top === undefined) {
      throw new Error("Expected a top card.");
    }
    deck = observe(deck, {
      location: { zone: "active", index: 0 },
      evidence: { kind: "instance", instanceId: top.instanceId },
    }).deck;
    const selectors = [
      { kind: "instance", instanceId: top.instanceId } as const,
      { kind: "card-key", cardKey: top.card.name } as const,
      { kind: "classifier", classifier: "group", value: top.card.group } as const,
      { kind: "not", target: { kind: "card-key", cardKey: "never" } } as const,
      {
        kind: "all",
        targets: [
          { kind: "card-key", cardKey: top.card.name },
          { kind: "classifier", classifier: "group", value: top.card.group },
        ],
      } as const,
      {
        kind: "any",
        targets: [
          { kind: "card-key", cardKey: "never" },
          { kind: "instance", instanceId: top.instanceId },
        ],
      } as const,
    ];
    for (const target of selectors) {
      deck = observe(deck, {
        location: { zone: "active", index: 0 },
        evidence: { kind: "target", target, matches: true },
      }).deck;
    }

    const replayed = replayEventLog(serializeEventLog(deck, codec), { config, codec });
    expect(getActiveCards(replayed)).toEqual(getActiveCards(deck));
    expect(getDrawnCards(replayed)).toEqual(getDrawnCards(deck));
  });

  it("rejects malformed and divergent recorded resolutions", () => {
    let deck = createDeck({
      cards: [
        { name: "a", group: "target" },
        { name: "b", group: "other" },
        { name: "c", group: "other" },
      ],
      config,
      random: createSeededRandom({ seed: 17n }),
    });
    deck = shuffleDeck(deck).deck;
    const drawn = drawCards(deck);
    deck = drawn.deck;
    const drawnId = drawn.output.instances[0]?.instanceId;
    if (drawnId === undefined) {
      throw new Error("Expected a drawn ID.");
    }
    deck = insertCards(deck, {
      items: [{ kind: "drawn", instanceId: drawnId }],
      placement: { kind: "index", index: 0 },
      visibility: "revealed",
    }).deck;
    deck = insertCards(deck, {
      items: [{ kind: "new", card: { name: "new", group: "other" } }],
      placement: { kind: "random-within", startGap: 0, endGap: deck.length },
    }).deck;
    deck = moveCards(deck, {
      selection: { kind: "indices", indices: [0, 1] },
      placement: { kind: "index", index: 0 },
      visibility: "revealed",
    }).deck;
    const activeIds = getActiveCards(deck).map((instance) => instance.instanceId);
    const selectedId = activeIds[0];
    if (selectedId === undefined) {
      throw new Error("Expected a move ID.");
    }
    deck = moveCards(deck, {
      selection: { kind: "instances", instanceIds: [selectedId] },
      placement: { kind: "from-bottom", offset: 0 },
    }).deck;
    const top = getActiveCards(deck)[0];
    if (top === undefined) {
      throw new Error("Expected an observation target.");
    }
    deck = observe(deck, {
      location: { zone: "active", index: 0 },
      evidence: { kind: "instance", instanceId: top.instanceId },
    }).deck;
    deck = observe(deck, {
      location: { zone: "active", index: 0 },
      evidence: {
        kind: "target",
        target: { kind: "card-key", cardKey: top.card.name },
        matches: true,
      },
    }).deck;
    const log = serializeEventLog(deck, codec);

    expectReplayCode(false, "INVALID_SERIALIZED_DATA");
    expectReplayCode({ schemaVersion: "probadeck.events/v1" }, "INVALID_SERIALIZED_DATA");
    expectReplayCode(
      alterLogEvent(log, 1, "resolution", { region: false }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 1, "resolution", { instanceIds: false }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 1, "resolution", { instanceIds: [false] }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 1, "resolution", {
        region: { startIndex: false, endIndexExclusive: 3 },
      }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 1, "request", { visibility: "invalid" }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 1, "resolution", {
        region: { startIndex: -1, endIndexExclusive: 3 },
      }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 1, "resolution", { instanceIds: ["instance-1"] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(alterLogEvent(log, 3, "resolution", { appliedGap: 99 }), "REPLAY_DIVERGENCE");
    expectReplayCode(
      alterLogEvent(log, 3, "resolution", { instanceIds: ["missing"] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 3, "request", { drawnInstanceIds: ["missing"] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 4, "request", { order: "invalid" }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 4, "request", { placement: { kind: "invalid" } }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 4, "request", { instanceIds: ["missing"] }),
      "REPLAY_DIVERGENCE",
    );
    const missingCatalogRequest = alterLogEvent(log, 4, "request", {
      instanceIds: ["missing"],
    });
    expectReplayCode(
      alterLogEvent(missingCatalogRequest, 4, "resolution", { instanceIds: ["missing"] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 5, "request", { selection: { kind: "invalid" } }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 5, "resolution", { sourceIndices: [99] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 5, "resolution", { instanceIds: ["missing"] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 5, "request", { selection: { kind: "indices", indices: [2] } }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 6, "request", {
        selection: { kind: "instances", instanceIds: ["instance-2"] },
      }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(alterLogEvent(log, 5, "resolution", { appliedGap: 99 }), "REPLAY_DIVERGENCE");
    expectReplayCode(alterLogEvent(log, 2, "request", { count: 0 }), "REPLAY_DIVERGENCE");
    expectReplayCode(
      alterLogEvent(log, 2, "resolution", { instanceIds: ["missing"] }),
      "REPLAY_DIVERGENCE",
    );
    expectReplayCode(
      alterLogEvent(log, 7, "request", { location: { zone: "invalid", index: 0 } }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 8, "request", {
        evidence: { kind: "target", target: { kind: "card-key", cardKey: "a" }, matches: "yes" },
      }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 8, "request", { evidence: { kind: "invalid" } }),
      "INVALID_SERIALIZED_DATA",
    );
    expectReplayCode(
      alterLogEvent(log, 8, "request", {
        evidence: { kind: "target", target: { kind: "invalid" }, matches: true },
      }),
      "INVALID_SERIALIZED_DATA",
    );
    const cyclicTarget: Record<string, JsonValue> = { kind: "not" };
    cyclicTarget.target = cyclicTarget;
    expectReplayCode(
      alterLogEvent(log, 8, "request", {
        evidence: { kind: "target", target: cyclicTarget, matches: true },
      }),
      "INVALID_SERIALIZED_DATA",
    );
    const snapshot = jsonObject(log.snapshot, "snapshot");
    const events = jsonArray(snapshot.events, "events");
    const unsupported = jsonObject(events[1], "shuffle event");
    const unsupportedObservation = jsonObject(unsupported.observation, "observation");
    expectReplayCode(
      replaceLogEvent(log, 1, {
        ...unsupported,
        kind: "unsupported",
        observation: { ...unsupportedObservation, kind: "unsupported" },
      }),
      "INVALID_SERIALIZED_DATA",
    );
    const creation = jsonObject(events[0], "creation");
    const creationResolution = jsonObject(creation.resolution, "creation resolution");
    expectReplayCode(
      replaceLogEvent(log, 0, {
        ...creation,
        resolution: { ...creationResolution, active: ["missing"] },
      }),
      "REPLAY_DIVERGENCE",
    );

    const simpleCreated = createDeck({
      cards: [
        { name: "a", group: "target" },
        { name: "b", group: "other" },
      ],
      config,
      random: createSeededRandom({ seed: 3n }),
    });
    const simple = shuffleDeck(simpleCreated).deck;
    const simpleLog = serializeEventLog(simple, codec);
    const simpleSnapshot = jsonObject(simpleLog.snapshot, "simple snapshot");
    const simpleEvents = jsonArray(simpleSnapshot.events, "simple events");
    const shuffleEvent = jsonObject(simpleEvents[1], "simple shuffle");
    const shuffleResolution = jsonObject(shuffleEvent.resolution, "simple resolution");
    const applied = jsonArray(shuffleResolution.instanceIds, "applied IDs");
    const reversed: JsonValue[] = [];
    for (const value of applied) {
      reversed.unshift(value);
    }
    expectReplayCode(
      replaceLogEvent(simpleLog, 1, {
        ...shuffleEvent,
        resolution: { ...shuffleResolution, instanceIds: reversed },
      }),
      "REPLAY_DIVERGENCE",
    );

    expect(
      replayEventLog(log, {
        config,
        codec,
        throughSequence: 1,
        random: createSeededRandom({ seed: 99n }),
      }).revision,
    ).toBe(1);
  });
});
