import { deriveCardInstance, normalizeConfig } from "./config.js";
import { fail } from "./errors.js";
import { canonicalizeKnowledge } from "./knowledge/canonicalize.js";
import {
  fixedCell,
  poolCell,
  type KnowledgeCell,
  type KnowledgeHypothesis,
  type UniformPool,
} from "./knowledge/state.js";
import { fraction } from "./math/fraction.js";
import { asInternalDeck, makeDeck } from "./model/state.js";
import { restorePcg32, serializePcg32 } from "./random/pcg32.js";
import type {
  AuditEvent,
  CardCodec,
  CardInstance,
  Deck,
  JsonObject,
  JsonValue,
  ObserverEvent,
  RandomSource,
  RestoreOptions,
} from "./types.js";

const SNAPSHOT_SCHEMA = "probadeck.snapshot/v1";

function fractionJson(value: KnowledgeHypothesis["weight"]): JsonObject {
  return Object.freeze({
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
  });
}

function cellJson(cell: KnowledgeCell): JsonObject {
  return cell.kind === "fixed"
    ? Object.freeze({ kind: cell.kind, instanceId: cell.instanceId })
    : Object.freeze({ kind: cell.kind, poolId: cell.poolId });
}

function poolJson(pool: UniformPool): JsonObject {
  return Object.freeze({
    poolId: pool.poolId,
    candidates: Object.freeze([...pool.candidates]),
  });
}

function encodeCard<TCard>(card: TCard, codec: CardCodec<TCard>): JsonValue {
  let encoded: JsonValue;
  try {
    encoded = codec.encode(card);
  } catch (error) {
    fail("INVALID_SERIALIZED_DATA", "The card codec failed to encode a card.", {}, error);
  }
  if (!isJsonValue(encoded)) {
    fail("INVALID_SERIALIZED_DATA", "The card codec returned a non-JSON value.");
  }
  return encoded;
}

function instanceJson<TCard>(instance: CardInstance<TCard>, codec: CardCodec<TCard>): JsonObject {
  const classifiers: Record<string, JsonValue> = {};
  for (const [name, values] of Object.entries(instance.classifiers)) {
    classifiers[name] = Object.freeze([...values]);
  }
  return Object.freeze({
    instanceId: instance.instanceId,
    card: encodeCard(instance.card, codec),
    cardKey: instance.cardKey,
    classifiers: Object.freeze(classifiers),
  });
}

function observerEventJson(event: ObserverEvent): JsonObject {
  return Object.freeze({
    schemaVersion: event.schemaVersion,
    sequence: event.sequence,
    revision: event.revision,
    kind: event.kind,
    details: event.details,
  });
}

function auditEventJson(event: AuditEvent): JsonObject {
  return Object.freeze({
    schemaVersion: event.schemaVersion,
    sequence: event.sequence,
    revision: event.revision,
    kind: event.kind,
    request: event.request,
    resolution: event.resolution,
    observation: observerEventJson(event.observation),
  });
}

export function serializeSnapshot<TCard>(
  publicDeck: Deck<TCard>,
  codec: CardCodec<TCard>,
): JsonObject {
  const deck = asInternalDeck(publicDeck);
  const knowledge = Object.freeze(
    deck.knowledge.hypotheses.map((hypothesis) =>
      Object.freeze({
        weight: fractionJson(hypothesis.weight),
        active: Object.freeze(hypothesis.active.map(cellJson)),
        drawn: Object.freeze(hypothesis.drawn.map(cellJson)),
        pools: Object.freeze([...hypothesis.pools.values()].map(poolJson)),
      }),
    ),
  );
  const random = deck.random === undefined ? null : (serializePcg32(deck.random) ?? null);

  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA,
    revision: deck.revision,
    maxHypotheses: deck.maxHypotheses,
    nextInstanceNumber: deck.nextInstanceNumber,
    instances: Object.freeze(
      [...deck.instances.values()].map((instance) => instanceJson(instance, codec)),
    ),
    active: Object.freeze([...deck.active]),
    drawn: Object.freeze([...deck.drawn]),
    knowledge,
    random,
    randomAlgorithm: deck.random?.algorithm ?? null,
    events: Object.freeze(deck.events.map(auditEventJson)),
  });
}

function isJsonValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, nextAncestors));
  }
  return Object.values(value).every((entry) => isJsonValue(entry, nextAncestors));
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: JsonValue | undefined, field: string): JsonObject {
  if (!isJsonObject(value)) {
    fail("INVALID_SERIALIZED_DATA", `${field} must be an object.`, { field });
  }
  return value;
}

function requireArray(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    fail("INVALID_SERIALIZED_DATA", `${field} must be an array.`, { field });
  }
  return value;
}

function requireString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string") {
    fail("INVALID_SERIALIZED_DATA", `${field} must be a string.`, { field });
  }
  return value;
}

function requireInteger(value: JsonValue | undefined, field: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    fail("INVALID_SERIALIZED_DATA", `${field} must be a safe integer of at least ${minimum}.`, {
      field,
    });
  }
  return value;
}

function requireBigInt(value: JsonValue | undefined, field: string): bigint {
  const encoded = requireString(value, field);
  try {
    return BigInt(encoded);
  } catch (error) {
    return fail(
      "INVALID_SERIALIZED_DATA",
      `${field} must be a decimal integer string.`,
      { field },
      error,
    );
  }
}

function stringArray(value: JsonValue | undefined, field: string): readonly string[] {
  return Object.freeze(
    requireArray(value, field).map((entry, index) => requireString(entry, `${field}[${index}]`)),
  );
}

function parseClassifiers(
  value: JsonValue | undefined,
): Readonly<Record<string, readonly string[]>> {
  const object = requireObject(value, "classifiers");
  const classifiers: Record<string, readonly string[]> = {};
  for (const [name, values] of Object.entries(object)) {
    classifiers[name] = stringArray(values, `classifiers.${name}`);
  }
  return Object.freeze(classifiers);
}

function decodeCard<TCard>(value: JsonValue, codec: CardCodec<TCard>): TCard {
  try {
    return codec.decode(value);
  } catch (error) {
    return fail("INVALID_SERIALIZED_DATA", "The card codec failed to decode a card.", {}, error);
  }
}

function metadataSignature(instance: CardInstance<unknown>): string {
  return JSON.stringify({ cardKey: instance.cardKey, classifiers: instance.classifiers });
}

function parseInstances<TCard>(
  value: JsonValue | undefined,
  options: RestoreOptions<TCard>,
): ReadonlyMap<string, CardInstance<TCard>> {
  const config = normalizeConfig(options.config);
  const instances = new Map<string, CardInstance<TCard>>();
  for (const [index, raw] of requireArray(value, "instances").entries()) {
    const object = requireObject(raw, `instances[${index}]`);
    const instanceId = requireString(object.instanceId, `instances[${index}].instanceId`);
    if (instances.has(instanceId)) {
      fail("INVALID_SERIALIZED_DATA", "Serialized instances contain a duplicate ID.", {
        instanceId,
      });
    }
    const rawCard = object.card;
    if (rawCard === undefined) {
      fail("INVALID_SERIALIZED_DATA", `instances[${index}].card is required.`);
    }
    const card = decodeCard(rawCard, options.codec);
    const derived = deriveCardInstance(instanceId, card, config);
    const recorded: CardInstance<unknown> = Object.freeze({
      instanceId,
      card,
      cardKey: requireString(object.cardKey, `instances[${index}].cardKey`),
      classifiers: parseClassifiers(object.classifiers),
    });
    if (metadataSignature(derived) !== metadataSignature(recorded)) {
      fail("CARD_METADATA_MISMATCH", `Card metadata differs for instance '${instanceId}'.`, {
        instanceId,
      });
    }
    instances.set(instanceId, derived);
  }
  return instances;
}

function parseCell(value: JsonValue, field: string): KnowledgeCell {
  const object = requireObject(value, field);
  if (object.kind === "fixed") {
    return fixedCell(requireString(object.instanceId, `${field}.instanceId`));
  }
  if (object.kind === "pool") {
    return poolCell(requireString(object.poolId, `${field}.poolId`));
  }
  return fail("INVALID_SERIALIZED_DATA", `${field}.kind is invalid.`, { field });
}

function parseCells(value: JsonValue | undefined, field: string): readonly KnowledgeCell[] {
  return Object.freeze(
    requireArray(value, field).map((entry, index) => parseCell(entry, `${field}[${index}]`)),
  );
}

function parsePools(value: JsonValue | undefined, field: string): ReadonlyMap<string, UniformPool> {
  const pools = new Map<string, UniformPool>();
  for (const [index, raw] of requireArray(value, field).entries()) {
    const object = requireObject(raw, `${field}[${index}]`);
    const poolId = requireString(object.poolId, `${field}[${index}].poolId`);
    if (pools.has(poolId)) {
      fail("INVALID_SERIALIZED_DATA", "Serialized knowledge contains a duplicate pool ID.", {
        poolId,
      });
    }
    pools.set(
      poolId,
      Object.freeze({
        poolId,
        candidates: stringArray(object.candidates, `${field}[${index}].candidates`),
      }),
    );
  }
  return pools;
}

function parseKnowledge(
  value: JsonValue | undefined,
  maxHypotheses: number,
): ReturnType<typeof canonicalizeKnowledge> {
  const hypotheses = requireArray(value, "knowledge").map((raw, index) => {
    const object = requireObject(raw, `knowledge[${index}]`);
    const weight = requireObject(object.weight, `knowledge[${index}].weight`);
    return Object.freeze({
      weight: fraction(
        requireBigInt(weight.numerator, `knowledge[${index}].weight.numerator`),
        requireBigInt(weight.denominator, `knowledge[${index}].weight.denominator`),
      ),
      active: parseCells(object.active, `knowledge[${index}].active`),
      drawn: parseCells(object.drawn, `knowledge[${index}].drawn`),
      pools: parsePools(object.pools, `knowledge[${index}].pools`),
    });
  });
  return canonicalizeKnowledge(hypotheses, maxHypotheses);
}

function parseObserverEvent(value: JsonValue | undefined, field: string): ObserverEvent {
  const object = requireObject(value, field);
  if (object.schemaVersion !== 1) {
    fail("UNSUPPORTED_SCHEMA_VERSION", `${field}.schemaVersion is unsupported.`);
  }
  return Object.freeze({
    schemaVersion: 1,
    sequence: requireInteger(object.sequence, `${field}.sequence`, 0),
    revision: requireInteger(object.revision, `${field}.revision`, 0),
    kind: requireString(object.kind, `${field}.kind`),
    details: requireObject(object.details, `${field}.details`),
  });
}

function parseEvents(value: JsonValue | undefined): readonly AuditEvent[] {
  const events = requireArray(value, "events").map((raw, index) => {
    const field = `events[${index}]`;
    const object = requireObject(raw, field);
    if (object.schemaVersion !== 1) {
      fail("UNSUPPORTED_SCHEMA_VERSION", `${field}.schemaVersion is unsupported.`);
    }
    const sequence = requireInteger(object.sequence, `${field}.sequence`, 0);
    const revision = requireInteger(object.revision, `${field}.revision`, 0);
    const observation = parseObserverEvent(object.observation, `${field}.observation`);
    if (
      sequence !== index ||
      revision !== index ||
      observation.sequence !== sequence ||
      observation.revision !== revision
    ) {
      fail("INVALID_SERIALIZED_DATA", "Serialized event sequence or revision is not contiguous.", {
        index,
      });
    }
    const kind = requireString(object.kind, `${field}.kind`);
    if (observation.kind !== kind) {
      fail("INVALID_SERIALIZED_DATA", "Observer and audit event kinds differ.", { index });
    }
    return Object.freeze({
      schemaVersion: 1,
      sequence,
      revision,
      kind,
      request: requireObject(object.request, `${field}.request`),
      resolution: requireObject(object.resolution, `${field}.resolution`),
      observation,
    });
  });
  if (events.length === 0 || events[0]?.kind !== "deck.created") {
    fail("INVALID_SERIALIZED_DATA", "A serialized event stream must begin with deck.created.");
  }
  return Object.freeze(events);
}

function parseRandom(
  value: JsonValue | undefined,
  replacement: RandomSource | undefined,
): RandomSource | undefined {
  if (value === null || value === undefined) {
    return replacement;
  }
  const object = requireObject(value, "random");
  return restorePcg32(object);
}

function validatePartition(
  instances: ReadonlyMap<string, unknown>,
  active: readonly string[],
  drawn: readonly string[],
): void {
  const occupied = [...active, ...drawn];
  if (new Set(occupied).size !== occupied.length || occupied.length !== instances.size) {
    fail("INVALID_SERIALIZED_DATA", "Active and drawn zones must partition the instance registry.");
  }
  for (const instanceId of occupied) {
    if (!instances.has(instanceId)) {
      fail("INVALID_SERIALIZED_DATA", `A zone references unknown instance '${instanceId}'.`, {
        instanceId,
      });
    }
  }
}

export function restoreSnapshot<TCard>(
  value: JsonValue,
  options: RestoreOptions<TCard>,
): Deck<TCard> {
  const object = requireObject(value, "snapshot");
  if (object.schemaVersion !== SNAPSHOT_SCHEMA) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "Unsupported snapshot schema version.");
  }
  const revision = requireInteger(object.revision, "revision", 0);
  const maxHypotheses = requireInteger(object.maxHypotheses, "maxHypotheses", 1);
  const nextInstanceNumber = requireInteger(object.nextInstanceNumber, "nextInstanceNumber", 1);
  const instances = parseInstances(object.instances, options);
  const active = stringArray(object.active, "active");
  const drawn = stringArray(object.drawn, "drawn");
  validatePartition(instances, active, drawn);
  const knowledge = parseKnowledge(object.knowledge, maxHypotheses);
  for (const hypothesis of knowledge.hypotheses) {
    if (hypothesis.active.length !== active.length || hypothesis.drawn.length !== drawn.length) {
      fail("INVALID_SERIALIZED_DATA", "Knowledge zone lengths differ from concrete zone lengths.");
    }
  }
  const events = parseEvents(object.events);
  if (events.length !== revision + 1) {
    fail("INVALID_SERIALIZED_DATA", "Snapshot revision does not match its event count.", {
      revision,
      eventCount: events.length,
    });
  }

  return makeDeck({
    revision,
    config: normalizeConfig(options.config),
    instances,
    active,
    drawn,
    nextInstanceNumber,
    knowledge,
    events,
    random: parseRandom(object.random, options.random),
    maxHypotheses,
  });
}
