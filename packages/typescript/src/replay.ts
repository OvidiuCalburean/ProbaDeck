import { fail } from "./errors.js";
import {
  conditionKnowledgeExact,
  drawKnowledge,
  insertKnownKnowledge,
  mixKnowledgeStates,
  moveKnowledgeByIndices,
  moveKnowledgeByIndicesOrdered,
  relocateKnownInstances,
  removeKnownInstancesFromZone,
  revealShuffleKnowledge,
  shuffleKnowledge,
} from "./knowledge/transitions.js";
import { asInternalDeck, createInitialDeck, makeDeck, type InternalDeck } from "./model/state.js";
import { observe } from "./operations/reducer.js";
import { resolvePlacementChoices } from "./operations/positions.js";
import { restoreSnapshot, serializeSnapshot } from "./serialization.js";
import type {
  AuditEvent,
  CardCodec,
  CardInstance,
  CardTarget,
  Deck,
  JsonObject,
  JsonValue,
  MoveSelection,
  Observation,
  OrderMode,
  Placement,
  ReplayOptions,
  Visibility,
} from "./types.js";

const EVENT_LOG_SCHEMA = "probadeck.events/v1";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: JsonValue | undefined, field: string): JsonObject {
  if (!isObject(value)) {
    fail("INVALID_SERIALIZED_DATA", `${field} must be an object.`, { field });
  }
  return value;
}

function arrayValue(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    fail("INVALID_SERIALIZED_DATA", `${field} must be an array.`, { field });
  }
  return value;
}

function stringValue(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string") {
    fail("INVALID_SERIALIZED_DATA", `${field} must be a string.`, { field });
  }
  return value;
}

function integerValue(value: JsonValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("INVALID_SERIALIZED_DATA", `${field} must be a safe integer.`, { field });
  }
  return value;
}

function stringValues(value: JsonValue | undefined, field: string): readonly string[] {
  return Object.freeze(
    arrayValue(value, field).map((entry, index) => stringValue(entry, `${field}[${index}]`)),
  );
}

function visibilityValue(value: JsonValue | undefined, field: string): Visibility {
  if (value !== "hidden" && value !== "revealed") {
    fail("INVALID_SERIALIZED_DATA", `${field} must be hidden or revealed.`, { field });
  }
  return value;
}

function orderValue(value: JsonValue | undefined, field: string): OrderMode {
  if (value !== "preserve" && value !== "random") {
    fail("INVALID_SERIALIZED_DATA", `${field} must be preserve or random.`, { field });
  }
  return value;
}

function placementValue(value: JsonValue | undefined, field: string): Placement {
  const object = objectValue(value, field);
  if (object.kind === "index") {
    return Object.freeze({
      kind: object.kind,
      index: integerValue(object.index, `${field}.index`),
    });
  }
  if (object.kind === "from-top" || object.kind === "from-bottom") {
    return Object.freeze({
      kind: object.kind,
      offset: integerValue(object.offset, `${field}.offset`),
    });
  }
  if (object.kind === "random-within") {
    return Object.freeze({
      kind: object.kind,
      startGap: integerValue(object.startGap, `${field}.startGap`),
      endGap: integerValue(object.endGap, `${field}.endGap`),
    });
  }
  return fail("INVALID_SERIALIZED_DATA", `${field}.kind is invalid.`, { field });
}

function targetValue(
  value: JsonValue | undefined,
  field: string,
  ancestors: ReadonlySet<object> = new Set(),
): CardTarget {
  const object = objectValue(value, field);
  if (ancestors.has(object)) {
    fail("INVALID_SERIALIZED_DATA", `${field} contains a cycle.`, { field });
  }
  if (object.kind === "instance") {
    return Object.freeze({
      kind: object.kind,
      instanceId: stringValue(object.instanceId, `${field}.instanceId`),
    });
  }
  if (object.kind === "card-key") {
    return Object.freeze({
      kind: object.kind,
      cardKey: stringValue(object.cardKey, `${field}.cardKey`),
    });
  }
  if (object.kind === "classifier") {
    return Object.freeze({
      kind: object.kind,
      classifier: stringValue(object.classifier, `${field}.classifier`),
      value: stringValue(object.value, `${field}.value`),
    });
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(object);
  if (object.kind === "not") {
    return Object.freeze({
      kind: object.kind,
      target: targetValue(object.target, `${field}.target`, nextAncestors),
    });
  }
  if (object.kind === "all" || object.kind === "any") {
    return Object.freeze({
      kind: object.kind,
      targets: Object.freeze(
        arrayValue(object.targets, `${field}.targets`).map((child, index) =>
          targetValue(child, `${field}.targets[${index}]`, nextAncestors),
        ),
      ),
    });
  }
  return fail("INVALID_SERIALIZED_DATA", `${field}.kind is invalid.`, { field });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((instanceId) => right.includes(instanceId));
}

function requireGap(gap: number, length: number, field: string): void {
  if (gap < 0 || gap > length) {
    fail("REPLAY_DIVERGENCE", `${field} is outside the replay deck.`, { gap, length });
  }
}

function insertAt<T>(values: readonly T[], gap: number, inserted: readonly T[]): readonly T[] {
  return Object.freeze([...values.slice(0, gap), ...inserted, ...values.slice(gap)]);
}

function replaceRange<T>(
  values: readonly T[],
  start: number,
  end: number,
  inserted: readonly T[],
): readonly T[] {
  return Object.freeze([...values.slice(0, start), ...inserted, ...values.slice(end)]);
}

function withRecordedEvent<TCard>(
  deck: InternalDeck<TCard>,
  event: AuditEvent,
  changes: Readonly<
    Partial<Pick<InternalDeck<TCard>, "instances" | "drawn" | "nextInstanceNumber">> &
      Pick<InternalDeck<TCard>, "active" | "knowledge">
  >,
): InternalDeck<TCard> {
  /* v8 ignore next -- snapshot validation guarantees contiguous event sequence and revision values */
  if (event.sequence !== deck.events.length || event.revision !== deck.revision + 1) {
    fail("REPLAY_DIVERGENCE", "Recorded event sequence diverges from replay state.", {
      sequence: event.sequence,
      revision: event.revision,
    });
  }
  return makeDeck({
    revision: event.revision,
    config: deck.config,
    instances: changes.instances ?? deck.instances,
    active: changes.active,
    drawn: changes.drawn ?? deck.drawn,
    nextInstanceNumber: changes.nextInstanceNumber ?? deck.nextInstanceNumber,
    knowledge: changes.knowledge,
    events: [...deck.events, event],
    random: deck.random,
    maxHypotheses: deck.maxHypotheses,
  });
}

export function serializeEventLog<TCard>(deck: Deck<TCard>, codec: CardCodec<TCard>): JsonObject {
  return Object.freeze({
    schemaVersion: EVENT_LOG_SCHEMA,
    snapshot: serializeSnapshot(deck, codec),
  });
}

function catalogFromFinal<TCard>(
  deck: InternalDeck<TCard>,
): ReadonlyMap<string, CardInstance<TCard>> {
  return deck.instances;
}

function replayShuffle<TCard>(deck: InternalDeck<TCard>, event: AuditEvent): InternalDeck<TCard> {
  const region = objectValue(event.resolution.region, "shuffle.resolution.region");
  const start = integerValue(region.startIndex, "shuffle.resolution.region.startIndex");
  const end = integerValue(region.endIndexExclusive, "shuffle.resolution.region.endIndexExclusive");
  if (start < 0 || end < start || end > deck.active.length) {
    fail("REPLAY_DIVERGENCE", "Recorded shuffle region is invalid.", { start, end });
  }
  const applied = stringValues(event.resolution.instanceIds, "shuffle.resolution.instanceIds");
  const selected = deck.active.slice(start, end);
  if (!sameIds(applied, selected)) {
    fail("REPLAY_DIVERGENCE", "Recorded shuffle permutation differs from its source region.");
  }
  const visibility = visibilityValue(event.request.visibility, "shuffle.request.visibility");
  const knowledge =
    visibility === "hidden"
      ? shuffleKnowledge(deck.knowledge, start, end, deck.maxHypotheses)
      : revealShuffleKnowledge(deck.knowledge, start, end, applied, deck.maxHypotheses);
  return withRecordedEvent(deck, event, {
    active: replaceRange(deck.active, start, end, applied),
    knowledge,
  });
}

function registerInserted<TCard>(
  deck: InternalDeck<TCard>,
  catalog: ReadonlyMap<string, CardInstance<TCard>>,
  insertedIds: readonly string[],
): ReadonlyMap<string, CardInstance<TCard>> {
  const instances = new Map(deck.instances);
  for (const instanceId of insertedIds) {
    if (instances.has(instanceId)) {
      continue;
    }
    const instance = catalog.get(instanceId);
    if (instance === undefined) {
      fail("REPLAY_DIVERGENCE", `Inserted instance '${instanceId}' is absent from the catalog.`, {
        instanceId,
      });
    }
    instances.set(instanceId, instance);
  }
  return instances;
}

function replayInsert<TCard>(
  deck: InternalDeck<TCard>,
  catalog: ReadonlyMap<string, CardInstance<TCard>>,
  event: AuditEvent,
): InternalDeck<TCard> {
  const requestedIds = stringValues(event.request.instanceIds, "insert.request.instanceIds");
  const drawnIds = stringValues(event.request.drawnInstanceIds, "insert.request.drawnInstanceIds");
  const appliedIds = stringValues(event.resolution.instanceIds, "insert.resolution.instanceIds");
  if (!sameIds(requestedIds, appliedIds)) {
    fail("REPLAY_DIVERGENCE", "Recorded insertion order has different instances from its request.");
  }
  for (const instanceId of drawnIds) {
    if (!deck.drawn.includes(instanceId)) {
      fail("REPLAY_DIVERGENCE", `Reinserted instance '${instanceId}' is not drawn.`, {
        instanceId,
      });
    }
  }
  const gap = integerValue(event.resolution.appliedGap, "insert.resolution.appliedGap");
  requireGap(gap, deck.active.length, "insert.resolution.appliedGap");
  const order = orderValue(event.request.order, "insert.request.order");
  const visibility = visibilityValue(event.request.visibility, "insert.request.visibility");
  const baseKnowledge =
    drawnIds.length === 0
      ? deck.knowledge
      : removeKnownInstancesFromZone(deck.knowledge, "drawn", drawnIds, deck.maxHypotheses);
  let knowledge;
  if (visibility === "hidden") {
    const placement = placementValue(event.request.placement, "insert.request.placement");
    const choices = resolvePlacementChoices(placement, deck.active.length, "clamp");
    knowledge = mixKnowledgeStates(
      choices.gaps.map((possibleGap) =>
        insertKnownKnowledge(
          baseKnowledge,
          possibleGap,
          requestedIds,
          order === "random",
          deck.maxHypotheses,
        ),
      ),
      deck.maxHypotheses,
    );
  } else {
    knowledge = insertKnownKnowledge(baseKnowledge, gap, appliedIds, false, deck.maxHypotheses);
  }
  const drawnSet = new Set(drawnIds);
  return withRecordedEvent(deck, event, {
    instances: registerInserted(deck, catalog, requestedIds),
    active: insertAt(deck.active, gap, appliedIds),
    drawn: Object.freeze(deck.drawn.filter((instanceId) => !drawnSet.has(instanceId))),
    nextInstanceNumber: integerValue(
      event.resolution.nextInstanceNumber,
      "insert.resolution.nextInstanceNumber",
    ),
    knowledge,
  });
}

function indicesSelection(value: JsonValue | undefined, field: string): readonly number[] {
  return Object.freeze(
    arrayValue(value, field).map((entry, index) => integerValue(entry, `${field}[${index}]`)),
  );
}

function moveSelection(value: JsonValue | undefined): MoveSelection {
  const object = objectValue(value, "move.request.selection");
  if (object.kind === "indices") {
    return Object.freeze({
      kind: object.kind,
      indices: indicesSelection(object.indices, "move.request.selection.indices"),
    });
  }
  if (object.kind === "instances") {
    return Object.freeze({
      kind: object.kind,
      instanceIds: stringValues(object.instanceIds, "move.request.selection.instanceIds"),
    });
  }
  return fail("INVALID_SERIALIZED_DATA", "move.request.selection.kind is invalid.");
}

function idsAtIndices(active: readonly string[], indices: readonly number[]): readonly string[] {
  return Object.freeze(
    indices.map((index) => {
      const instanceId = active[index];
      /* v8 ignore next -- selection indices and IDs are built from the same validated active array */
      if (instanceId === undefined) {
        fail("REPLAY_DIVERGENCE", `Move source index ${index} is outside the active deck.`, {
          index,
        });
      }
      return instanceId;
    }),
  );
}

function replayMove<TCard>(deck: InternalDeck<TCard>, event: AuditEvent): InternalDeck<TCard> {
  const selection = moveSelection(event.request.selection);
  const sourceIndices = indicesSelection(
    event.resolution.sourceIndices,
    "move.resolution.sourceIndices",
  );
  const sourceIds = idsAtIndices(deck.active, sourceIndices);
  const appliedIds = stringValues(event.resolution.instanceIds, "move.resolution.instanceIds");
  if (!sameIds(sourceIds, appliedIds)) {
    fail("REPLAY_DIVERGENCE", "Recorded move result differs from its source selection.");
  }
  if (
    selection.kind === "indices" &&
    !sameIds(idsAtIndices(deck.active, selection.indices), sourceIds)
  ) {
    fail("REPLAY_DIVERGENCE", "Recorded move source indices differ from the request.");
  }
  if (selection.kind === "instances" && !sameIds(selection.instanceIds, sourceIds)) {
    fail("REPLAY_DIVERGENCE", "Recorded move source instances differ from the request.");
  }
  const gap = integerValue(event.resolution.appliedGap, "move.resolution.appliedGap");
  const remainingLength = deck.active.length - sourceIndices.length;
  requireGap(gap, remainingLength, "move.resolution.appliedGap");
  const order = orderValue(event.request.order, "move.request.order");
  const visibility = visibilityValue(event.request.visibility, "move.request.visibility");
  let knowledge;

  if (visibility === "hidden") {
    const placement = placementValue(event.request.placement, "move.request.placement");
    const choices = resolvePlacementChoices(placement, remainingLength, "clamp");
    knowledge = mixKnowledgeStates(
      choices.gaps.map((possibleGap) =>
        selection.kind === "indices"
          ? moveKnowledgeByIndices(
              deck.knowledge,
              selection.indices,
              possibleGap,
              order === "random",
              deck.maxHypotheses,
            )
          : relocateKnownInstances(
              deck.knowledge,
              "active",
              sourceIds,
              possibleGap,
              order === "random",
              deck.maxHypotheses,
            ),
      ),
      deck.maxHypotheses,
    );
  } else if (selection.kind === "indices") {
    let conditioned = deck.knowledge;
    selection.indices.forEach((index, offset) => {
      const instanceId = idsAtIndices(deck.active, selection.indices)[offset];
      /* v8 ignore next -- forEach offsets are bounded by the same selected ID array */
      if (instanceId === undefined) {
        throw new Error("A replayed move is missing a selected ID.");
      }
      conditioned = conditionKnowledgeExact(
        conditioned,
        "active",
        index,
        instanceId,
        deck.maxHypotheses,
      );
    });
    const selectedIds = idsAtIndices(deck.active, selection.indices);
    const offsets = appliedIds.map((instanceId) => {
      const offset = selectedIds.indexOf(instanceId);
      /* v8 ignore next -- applied IDs were verified as the same set as the selected source IDs */
      if (offset === -1) {
        fail("REPLAY_DIVERGENCE", "Revealed move order contains an unknown source instance.");
      }
      return offset;
    });
    knowledge = moveKnowledgeByIndicesOrdered(
      conditioned,
      selection.indices,
      gap,
      offsets,
      deck.maxHypotheses,
    );
  } else {
    const removed = removeKnownInstancesFromZone(
      deck.knowledge,
      "active",
      sourceIds,
      deck.maxHypotheses,
    );
    knowledge = insertKnownKnowledge(removed, gap, appliedIds, false, deck.maxHypotheses);
  }

  const sourceSet = new Set(sourceIndices);
  const remaining = deck.active.filter((_instanceId, index) => !sourceSet.has(index));
  return withRecordedEvent(deck, event, {
    active: insertAt(remaining, gap, appliedIds),
    knowledge,
  });
}

function replayDraw<TCard>(deck: InternalDeck<TCard>, event: AuditEvent): InternalDeck<TCard> {
  const count = integerValue(event.request.count, "draw.request.count");
  const reveal = event.request.reveal;
  if (typeof reveal !== "boolean" || count < 1 || count > deck.active.length) {
    fail("REPLAY_DIVERGENCE", "Recorded draw request is invalid.");
  }
  const appliedIds = stringValues(event.resolution.instanceIds, "draw.resolution.instanceIds");
  const actualIds = deck.active.slice(0, count);
  if (appliedIds.length !== count || !appliedIds.every((id, index) => id === actualIds[index])) {
    fail("REPLAY_DIVERGENCE", "Recorded draw identities differ from the active deck.");
  }
  const priorDrawnLength = deck.drawn.length;
  let knowledge = drawKnowledge(deck.knowledge, count);
  if (reveal) {
    appliedIds.forEach((instanceId, index) => {
      knowledge = conditionKnowledgeExact(
        knowledge,
        "drawn",
        priorDrawnLength + index,
        instanceId,
        deck.maxHypotheses,
      );
    });
  }
  return withRecordedEvent(deck, event, {
    active: Object.freeze(deck.active.slice(count)),
    drawn: Object.freeze([...deck.drawn, ...appliedIds]),
    knowledge,
  });
}

function replayObservation<TCard>(
  deck: InternalDeck<TCard>,
  event: AuditEvent,
): InternalDeck<TCard> {
  const request = event.request;
  const location = objectValue(request.location, "observe.request.location");
  const evidence = objectValue(request.evidence, "observe.request.evidence");
  const zone = location.zone;
  if (zone !== "active" && zone !== "drawn") {
    fail("INVALID_SERIALIZED_DATA", "observe.request.location.zone is invalid.");
  }
  const locationValue = Object.freeze({
    zone,
    index: integerValue(location.index, "observe.request.location.index"),
  });
  let observation: Observation;
  if (evidence.kind === "instance") {
    observation = Object.freeze({
      location: locationValue,
      evidence: Object.freeze({
        kind: evidence.kind,
        instanceId: stringValue(evidence.instanceId, "observe.request.evidence.instanceId"),
      }),
    });
  } else if (evidence.kind === "target") {
    if (typeof evidence.matches !== "boolean") {
      fail("INVALID_SERIALIZED_DATA", "observe.request.evidence.matches must be boolean.");
    }
    observation = Object.freeze({
      location: locationValue,
      evidence: Object.freeze({
        kind: evidence.kind,
        target: targetValue(evidence.target, "observe.request.evidence.target"),
        matches: evidence.matches,
      }),
    });
  } else {
    return fail("INVALID_SERIALIZED_DATA", "observe.request.evidence.kind is invalid.");
  }
  const applied = asInternalDeck(observe(deck, observation).deck);
  return makeDeck({
    revision: event.revision,
    config: applied.config,
    instances: applied.instances,
    active: applied.active,
    drawn: applied.drawn,
    nextInstanceNumber: applied.nextInstanceNumber,
    knowledge: applied.knowledge,
    events: [...deck.events, event],
    random: deck.random,
    maxHypotheses: applied.maxHypotheses,
  });
}

function replayEvent<TCard>(
  deck: InternalDeck<TCard>,
  catalog: ReadonlyMap<string, CardInstance<TCard>>,
  event: AuditEvent,
): InternalDeck<TCard> {
  if (event.kind === "deck.shuffled") {
    return replayShuffle(deck, event);
  }
  if (event.kind === "cards.inserted") {
    return replayInsert(deck, catalog, event);
  }
  if (event.kind === "cards.moved") {
    return replayMove(deck, event);
  }
  if (event.kind === "cards.drawn") {
    return replayDraw(deck, event);
  }
  if (event.kind === "card.observed") {
    return replayObservation(deck, event);
  }
  return fail("INVALID_SERIALIZED_DATA", `Unsupported event kind '${event.kind}'.`, {
    kind: event.kind,
  });
}

function compareFullReplay<TCard>(
  replayed: InternalDeck<TCard>,
  finalDeck: InternalDeck<TCard>,
  codec: CardCodec<TCard>,
): void {
  if (
    JSON.stringify(serializeSnapshot(replayed, codec)) !==
    JSON.stringify(serializeSnapshot(finalDeck, codec))
  ) {
    fail("REPLAY_DIVERGENCE", "Replayed state differs from the recorded final snapshot.");
  }
}

export function replayEventLog<TCard>(
  value: JsonValue,
  options: ReplayOptions<TCard>,
): Deck<TCard> {
  const envelope = objectValue(value, "eventLog");
  if (envelope.schemaVersion !== EVENT_LOG_SCHEMA) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "Unsupported event-log schema version.");
  }
  const snapshotValue = envelope.snapshot;
  if (snapshotValue === undefined) {
    fail("INVALID_SERIALIZED_DATA", "eventLog.snapshot is required.");
  }
  const finalDeck = asInternalDeck(restoreSnapshot(snapshotValue, options));
  const events = finalDeck.events;
  const lastSequence = events.length - 1;
  const throughSequence = options.throughSequence ?? lastSequence;
  if (
    !Number.isSafeInteger(throughSequence) ||
    throughSequence < 0 ||
    throughSequence > lastSequence
  ) {
    fail("INVALID_SERIALIZED_DATA", "throughSequence is outside the event stream.", {
      throughSequence,
      lastSequence,
    });
  }
  const creation = events[0];
  /* v8 ignore next -- restored snapshots require a non-empty stream beginning with deck.created */
  if (creation === undefined) {
    fail("INVALID_SERIALIZED_DATA", "Event stream is empty.");
  }
  const initialIds = stringValues(creation.resolution.active, "creation.resolution.active");
  const catalog = catalogFromFinal(finalDeck);
  const initialCards = initialIds.map((instanceId) => {
    const instance = catalog.get(instanceId);
    if (instance === undefined) {
      fail("REPLAY_DIVERGENCE", `Initial instance '${instanceId}' is absent from the catalog.`, {
        instanceId,
      });
    }
    return instance.card;
  });
  const created = asInternalDeck(
    createInitialDeck({
      cards: initialCards,
      instanceIds: initialIds,
      config: options.config,
      maxHypotheses: finalDeck.maxHypotheses,
    }),
  );
  let replayed = makeDeck({
    revision: 0,
    config: created.config,
    instances: created.instances,
    active: created.active,
    drawn: created.drawn,
    nextInstanceNumber: integerValue(
      creation.resolution.nextInstanceNumber,
      "creation.resolution.nextInstanceNumber",
    ),
    knowledge: created.knowledge,
    events: [creation],
    random: undefined,
    maxHypotheses: created.maxHypotheses,
  });

  for (let sequence = 1; sequence <= throughSequence; sequence += 1) {
    const event = events[sequence];
    /* v8 ignore next -- validated contiguous events and the checked upper bound guarantee this index */
    if (event === undefined) {
      fail("INVALID_SERIALIZED_DATA", `Missing event at sequence ${sequence}.`, { sequence });
    }
    replayed = replayEvent(replayed, catalog, event);
  }

  if (throughSequence === lastSequence) {
    replayed = makeDeck({
      revision: replayed.revision,
      config: replayed.config,
      instances: replayed.instances,
      active: replayed.active,
      drawn: replayed.drawn,
      nextInstanceNumber: finalDeck.nextInstanceNumber,
      knowledge: replayed.knowledge,
      events: replayed.events,
      random: finalDeck.random,
      maxHypotheses: replayed.maxHypotheses,
    });
    compareFullReplay(replayed, finalDeck, options.codec);
  } else if (options.random !== undefined) {
    replayed = makeDeck({
      revision: replayed.revision,
      config: replayed.config,
      instances: replayed.instances,
      active: replayed.active,
      drawn: replayed.drawn,
      nextInstanceNumber: replayed.nextInstanceNumber,
      knowledge: replayed.knowledge,
      events: replayed.events,
      random: options.random,
      maxHypotheses: replayed.maxHypotheses,
    });
  }
  return replayed;
}
