import { fail } from "../errors.js";
import {
  conditionKnowledgeExact,
  conditionKnowledgeTarget,
  drawKnowledge,
  insertKnownKnowledge,
  mixKnowledgeStates,
  moveKnowledgeByIndices,
  moveKnowledgeByIndicesOrdered,
  relocateKnownInstances,
  removeKnownInstancesFromZone,
  revealShuffleKnowledge,
  shuffleKnowledge,
} from "../knowledge/transitions.js";
import { addInstance, requireInstance, type InstanceRegistry } from "../model/instances.js";
import {
  asInternalDeck,
  createInitialDeck,
  makeDeck,
  nextEvent,
  type InternalDeck,
} from "../model/state.js";
import { instanceMatchesTarget, validateTarget } from "../probability/targets.js";
import { shuffleValues } from "../random/sampling.js";
import type {
  AuditEvent,
  CardInstance,
  CardTarget,
  CreateDeckOptions,
  Deck,
  DrawOptions,
  DrawOutput,
  IndexRange,
  InsertOptions,
  InsertOutput,
  JsonObject,
  JsonValue,
  Location,
  MoveOptions,
  MoveOutput,
  Observation,
  ObservationEvidence,
  ObservationOutput,
  ObserverEvent,
  OperationResult,
  Placement,
  RandomDecision,
  ShuffleOptions,
  ShuffleOutput,
} from "../types.js";
import { resolvePlacement, resolvePlacementChoices, resolveRange } from "./positions.js";

function placementJson(placement: Placement): JsonObject {
  if (placement.kind === "index") {
    return Object.freeze({ kind: placement.kind, index: placement.index });
  }
  if (placement.kind === "from-top" || placement.kind === "from-bottom") {
    return Object.freeze({ kind: placement.kind, offset: placement.offset });
  }
  return Object.freeze({
    kind: placement.kind,
    startGap: placement.startGap,
    endGap: placement.endGap,
  });
}

function rangeJson(range: IndexRange): JsonObject {
  return Object.freeze({
    startIndex: range.startIndex,
    endIndexExclusive: range.endIndexExclusive,
  });
}

function targetJson(target: CardTarget): JsonObject {
  if (target.kind === "instance") {
    return Object.freeze({ kind: target.kind, instanceId: target.instanceId });
  }
  if (target.kind === "card-key") {
    return Object.freeze({ kind: target.kind, cardKey: target.cardKey });
  }
  if (target.kind === "classifier") {
    return Object.freeze({
      kind: target.kind,
      classifier: target.classifier,
      value: target.value,
    });
  }
  if (target.kind === "not") {
    return Object.freeze({ kind: target.kind, target: targetJson(target.target) });
  }
  return Object.freeze({
    kind: target.kind,
    targets: Object.freeze(target.targets.map(targetJson)),
  });
}

function locationJson(location: Location): JsonObject {
  return Object.freeze({ zone: location.zone, index: location.index });
}

function evidenceJson(evidence: ObservationEvidence): JsonObject {
  if (evidence.kind === "instance") {
    return Object.freeze({ kind: evidence.kind, instanceId: evidence.instanceId });
  }
  return Object.freeze({
    kind: evidence.kind,
    target: targetJson(evidence.target),
    matches: evidence.matches,
  });
}

function decisionJson(decision: RandomDecision): JsonObject {
  return Object.freeze({
    upperExclusive: decision.upperExclusive,
    words: Object.freeze([...decision.words]),
    value: decision.value,
  });
}

function decisionsJson(decisions: readonly RandomDecision[]): readonly JsonValue[] {
  return Object.freeze(decisions.map(decisionJson));
}

function sortedNumbers(values: readonly number[]): readonly number[] {
  const result: number[] = [];
  for (const value of values) {
    const insertionIndex = result.findIndex((existing) => value < existing);
    result.splice(insertionIndex === -1 ? result.length : insertionIndex, 0, value);
  }
  return Object.freeze(result);
}

function validateUniqueStrings(values: readonly string[], field: string): void {
  if (values.length === 0) {
    fail("INVALID_COUNT", `${field} must contain at least one item.`, { field });
  }
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      fail("INVALID_POSITION", `${field} must contain non-empty strings.`, { field });
    }
    if (seen.has(value)) {
      fail("INVALID_POSITION", `${field} must not contain duplicates.`, { field, value });
    }
    seen.add(value);
  }
}

function validateIndices(indices: readonly number[], length: number): readonly number[] {
  if (indices.length === 0) {
    fail("INVALID_COUNT", "indices must contain at least one item.");
  }
  const seen = new Set<number>();
  for (const index of indices) {
    if (!Number.isSafeInteger(index)) {
      fail("INVALID_POSITION", "Move indices must be safe integers.", { index });
    }
    if (index < 0 || index >= length) {
      fail("POSITION_OUT_OF_BOUNDS", `Move index ${index} is outside 0..${length - 1}.`, {
        index,
        length,
      });
    }
    if (seen.has(index)) {
      fail("INVALID_POSITION", "Move indices must not contain duplicates.", { index });
    }
    seen.add(index);
  }
  return sortedNumbers(indices);
}

function commit<TCard, TOutput>(
  deck: InternalDeck<TCard>,
  kind: string,
  request: JsonObject,
  resolution: JsonObject,
  observerDetails: JsonObject,
  changes: Readonly<
    Partial<
      Pick<InternalDeck<TCard>, "instances" | "active" | "drawn" | "nextInstanceNumber" | "random">
    > & { readonly knowledge: InternalDeck<TCard>["knowledge"] }
  >,
  output: TOutput,
): OperationResult<TCard, TOutput> {
  const event = nextEvent(deck, kind, request, resolution, observerDetails);
  const next = makeDeck({
    revision: event.revision,
    config: deck.config,
    instances: changes.instances ?? deck.instances,
    active: changes.active ?? deck.active,
    drawn: changes.drawn ?? deck.drawn,
    nextInstanceNumber: changes.nextInstanceNumber ?? deck.nextInstanceNumber,
    knowledge: changes.knowledge,
    events: [...deck.events, event],
    random: changes.random ?? deck.random,
    maxHypotheses: deck.maxHypotheses,
  });
  return Object.freeze({ deck: next, output, event });
}

function replaceRange<T>(
  values: readonly T[],
  startIndex: number,
  endIndexExclusive: number,
  replacement: readonly T[],
): readonly T[] {
  return Object.freeze([
    ...values.slice(0, startIndex),
    ...replacement,
    ...values.slice(endIndexExclusive),
  ]);
}

function insertAt<T>(values: readonly T[], gap: number, inserted: readonly T[]): readonly T[] {
  return Object.freeze([...values.slice(0, gap), ...inserted, ...values.slice(gap)]);
}

function selectedIdsByIndices(
  active: readonly string[],
  indices: readonly number[],
): readonly string[] {
  return Object.freeze(
    indices.map((index) => {
      const instanceId = active[index];
      /* v8 ignore next -- move indices are validated against the same active array */
      if (instanceId === undefined) {
        throw new Error(`Missing active instance at validated index ${index}.`);
      }
      return instanceId;
    }),
  );
}

function actualLocationId<TCard>(deck: InternalDeck<TCard>, location: Location): string {
  if (!Number.isSafeInteger(location.index) || location.index < 0) {
    fail("INVALID_POSITION", "Observation index must be a non-negative safe integer.", {
      index: location.index,
    });
  }
  const zone = location.zone === "active" ? deck.active : deck.drawn;
  const instanceId = zone[location.index];
  if (instanceId === undefined) {
    fail("POSITION_OUT_OF_BOUNDS", "Observation location is outside its zone.", {
      zone: location.zone,
      index: location.index,
      length: zone.length,
    });
  }
  return instanceId;
}

export function createDeck<TCard>(options: CreateDeckOptions<TCard>): Deck<TCard> {
  return createInitialDeck(options);
}

export function getActiveCards<TCard>(deck: Deck<TCard>): readonly CardInstance<TCard>[] {
  const internal = asInternalDeck(deck);
  return Object.freeze(
    internal.active.map((instanceId) => requireInstance(internal.instances, instanceId)),
  );
}

export function getDrawnCards<TCard>(deck: Deck<TCard>): readonly CardInstance<TCard>[] {
  const internal = asInternalDeck(deck);
  return Object.freeze(
    internal.drawn.map((instanceId) => requireInstance(internal.instances, instanceId)),
  );
}

export function getAuditLog<TCard>(deck: Deck<TCard>): readonly AuditEvent[] {
  return asInternalDeck(deck).events;
}

export function getObserverLog<TCard>(deck: Deck<TCard>): readonly ObserverEvent[] {
  return Object.freeze(asInternalDeck(deck).events.map((event) => event.observation));
}

export function shuffleDeck<TCard>(
  publicDeck: Deck<TCard>,
  options: ShuffleOptions = {},
): OperationResult<TCard, ShuffleOutput> {
  const deck = asInternalDeck(publicDeck);
  const bounds = options.bounds ?? "error";
  const visibility = options.visibility ?? "hidden";
  const resolved = resolveRange(options.region, deck.active.length, bounds);
  const { startIndex, endIndexExclusive } = resolved.range;
  const selected = deck.active.slice(startIndex, endIndexExclusive);

  const hiddenKnowledge =
    visibility === "hidden"
      ? shuffleKnowledge(deck.knowledge, startIndex, endIndexExclusive, deck.maxHypotheses)
      : undefined;

  const shuffled =
    selected.length > 1
      ? shuffleValues(
          selected,
          deck.random === undefined
            ? fail("RANDOM_SOURCE_REQUIRED", "This operation requires a random source.")
            : deck.random,
        )
      : Object.freeze({
          values: Object.freeze(selected),
          random: deck.random,
          decisions: Object.freeze([]),
        });
  const active = replaceRange(deck.active, startIndex, endIndexExclusive, shuffled.values);
  const knowledge =
    hiddenKnowledge ??
    revealShuffleKnowledge(
      deck.knowledge,
      startIndex,
      endIndexExclusive,
      shuffled.values,
      deck.maxHypotheses,
    );
  const request = Object.freeze({
    region: options.region === undefined ? null : rangeJson(options.region),
    bounds,
    visibility,
  });
  const resolution = Object.freeze({
    region: rangeJson(resolved.range),
    referenceLength: deck.active.length,
    wasClamped: resolved.wasClamped,
    instanceIds: Object.freeze([...shuffled.values]),
    randomDecisions: decisionsJson(shuffled.decisions),
  });
  const observerDetails = Object.freeze({
    region: rangeJson(resolved.range),
    referenceLength: deck.active.length,
    wasClamped: resolved.wasClamped,
    instanceIds: visibility === "revealed" ? Object.freeze([...shuffled.values]) : null,
  });
  const output: ShuffleOutput = Object.freeze({
    requestedRegion: options.region === undefined ? null : Object.freeze({ ...options.region }),
    region: resolved.range,
    referenceLength: deck.active.length,
    wasClamped: resolved.wasClamped,
  });
  return commit(
    deck,
    "deck.shuffled",
    request,
    resolution,
    observerDetails,
    { active, knowledge, random: shuffled.random },
    output,
  );
}

export function insertCards<TCard>(
  publicDeck: Deck<TCard>,
  options: InsertOptions<TCard>,
): OperationResult<TCard, InsertOutput<TCard>> {
  const deck = asInternalDeck(publicDeck);
  if (options.items.length === 0) {
    fail("INVALID_COUNT", "Insert items must contain at least one card.");
  }
  const order = options.order ?? "preserve";
  const visibility = options.visibility ?? "hidden";
  const bounds = options.bounds ?? "error";

  let registry: InstanceRegistry<TCard> = Object.freeze({
    instances: deck.instances,
    nextInstanceNumber: deck.nextInstanceNumber,
  });
  const insertedIds: string[] = [];
  const drawnIds: string[] = [];
  for (const item of options.items) {
    if (item.kind === "new") {
      registry = addInstance(registry, item.card, item.instanceId, deck.config);
      const addedId = [...registry.instances.keys()].find(
        (instanceId) => !deck.instances.has(instanceId) && !insertedIds.includes(instanceId),
      );
      /* v8 ignore next -- addInstance either throws or adds exactly one fresh registry entry */
      if (addedId === undefined) {
        throw new Error("A newly inserted card was not added to the instance registry.");
      }
      insertedIds.push(addedId);
      continue;
    }
    requireInstance(deck.instances, item.instanceId);
    if (!deck.drawn.includes(item.instanceId)) {
      fail("INSTANCE_NOT_DRAWN", `Instance '${item.instanceId}' is not in the drawn zone.`, {
        instanceId: item.instanceId,
      });
    }
    if (insertedIds.includes(item.instanceId)) {
      fail("INVALID_POSITION", "Insert items must not contain the same instance twice.", {
        instanceId: item.instanceId,
      });
    }
    insertedIds.push(item.instanceId);
    drawnIds.push(item.instanceId);
  }

  const placementChoices = resolvePlacementChoices(options.placement, deck.active.length, bounds);
  const baseKnowledge =
    drawnIds.length === 0
      ? deck.knowledge
      : removeKnownInstancesFromZone(deck.knowledge, "drawn", drawnIds, deck.maxHypotheses);
  const hiddenKnowledge =
    visibility === "hidden"
      ? mixKnowledgeStates(
          placementChoices.gaps.map((gap) =>
            insertKnownKnowledge(
              baseKnowledge,
              gap,
              insertedIds,
              order === "random",
              deck.maxHypotheses,
            ),
          ),
          deck.maxHypotheses,
        )
      : undefined;

  const placement = resolvePlacement(options.placement, deck.active.length, bounds, deck.random);
  const reordered =
    order === "random" && insertedIds.length > 1
      ? shuffleValues(
          insertedIds,
          placement.random === undefined
            ? fail("RANDOM_SOURCE_REQUIRED", "This operation requires a random source.")
            : placement.random,
        )
      : Object.freeze({
          values: Object.freeze([...insertedIds]),
          random: placement.random,
          decisions: Object.freeze([]),
        });
  const active = insertAt(deck.active, placement.gap, reordered.values);
  const drawnSet = new Set(drawnIds);
  const drawn = Object.freeze(deck.drawn.filter((instanceId) => !drawnSet.has(instanceId)));
  const knowledge =
    hiddenKnowledge ??
    insertKnownKnowledge(baseKnowledge, placement.gap, reordered.values, false, deck.maxHypotheses);
  const instances = Object.freeze(
    reordered.values.map((instanceId) => requireInstance(registry.instances, instanceId)),
  );
  const request = Object.freeze({
    instanceIds: Object.freeze([...insertedIds]),
    drawnInstanceIds: Object.freeze([...drawnIds]),
    placement: placementJson(options.placement),
    order,
    visibility,
    bounds,
  });
  const randomDecisions = Object.freeze([
    ...(placement.decision === undefined ? [] : [decisionJson(placement.decision)]),
    ...decisionsJson(reordered.decisions),
  ]);
  const resolution = Object.freeze({
    appliedGap: placement.gap,
    referenceLength: deck.active.length,
    wasClamped: placement.wasClamped,
    instanceIds: Object.freeze([...reordered.values]),
    nextInstanceNumber: registry.nextInstanceNumber,
    randomDecisions,
  });
  const hasHiddenGap =
    options.placement.kind === "random-within" && placementChoices.gaps.length > 1;
  const hasHiddenOrder = order === "random" && insertedIds.length > 1;
  const observerDetails = Object.freeze({
    appliedGap: visibility === "revealed" || !hasHiddenGap ? placement.gap : null,
    referenceLength: deck.active.length,
    wasClamped: placement.wasClamped,
    instanceIds:
      visibility === "revealed" || !hasHiddenOrder
        ? Object.freeze([...reordered.values])
        : Object.freeze([...insertedIds]),
  });
  const output: InsertOutput<TCard> = Object.freeze({
    instances,
    requestedPlacement: Object.freeze({ ...options.placement }),
    appliedGap: placement.gap,
    referenceLength: deck.active.length,
    wasClamped: placement.wasClamped,
  });
  return commit(
    deck,
    "cards.inserted",
    request,
    resolution,
    observerDetails,
    {
      instances: registry.instances,
      active,
      drawn,
      nextInstanceNumber: registry.nextInstanceNumber,
      knowledge,
      random: reordered.random,
    },
    output,
  );
}

interface ResolvedMoveSelection {
  readonly indices: readonly number[];
  readonly instanceIds: readonly string[];
  readonly kind: "indices" | "instances";
}

function resolveMoveSelection<TCard>(
  deck: InternalDeck<TCard>,
  selection: MoveOptions["selection"],
): ResolvedMoveSelection {
  if (selection.kind === "indices") {
    const indices = validateIndices(selection.indices, deck.active.length);
    return Object.freeze({
      indices,
      instanceIds: selectedIdsByIndices(deck.active, indices),
      kind: selection.kind,
    });
  }

  validateUniqueStrings(selection.instanceIds, "instanceIds");
  const indexById = new Map(deck.active.map((instanceId, index) => [instanceId, index]));
  const indices: number[] = [];
  for (const instanceId of selection.instanceIds) {
    requireInstance(deck.instances, instanceId);
    const index = indexById.get(instanceId);
    if (index === undefined) {
      fail("INVALID_POSITION", `Instance '${instanceId}' is not in the active deck.`, {
        instanceId,
      });
    }
    indices.push(index);
  }
  const sorted = sortedNumbers(indices);
  return Object.freeze({
    indices: sorted,
    instanceIds: selectedIdsByIndices(deck.active, sorted),
    kind: selection.kind,
  });
}

export function moveCards<TCard>(
  publicDeck: Deck<TCard>,
  options: MoveOptions,
): OperationResult<TCard, MoveOutput> {
  const deck = asInternalDeck(publicDeck);
  const selected = resolveMoveSelection(deck, options.selection);
  const order = options.order ?? "preserve";
  const visibility = options.visibility ?? "hidden";
  const bounds = options.bounds ?? "error";
  const remainingLength = deck.active.length - selected.indices.length;
  const placementChoices = resolvePlacementChoices(options.placement, remainingLength, bounds);

  let revealedBase = deck.knowledge;
  if (visibility === "revealed" && selected.kind === "indices") {
    selected.indices.forEach((index, offset) => {
      const instanceId = selected.instanceIds[offset];
      /* v8 ignore next -- selected indices and IDs are constructed with identical lengths */
      if (instanceId === undefined) {
        throw new Error("A revealed move is missing a selected instance ID.");
      }
      revealedBase = conditionKnowledgeExact(
        revealedBase,
        "active",
        index,
        instanceId,
        deck.maxHypotheses,
      );
    });
  } else if (visibility === "revealed") {
    revealedBase = removeKnownInstancesFromZone(
      deck.knowledge,
      "active",
      selected.instanceIds,
      deck.maxHypotheses,
    );
  }

  const hiddenKnowledge =
    visibility === "hidden"
      ? mixKnowledgeStates(
          placementChoices.gaps.map((gap) =>
            selected.kind === "indices"
              ? moveKnowledgeByIndices(
                  deck.knowledge,
                  selected.indices,
                  gap,
                  order === "random",
                  deck.maxHypotheses,
                )
              : relocateKnownInstances(
                  deck.knowledge,
                  "active",
                  selected.instanceIds,
                  gap,
                  order === "random",
                  deck.maxHypotheses,
                ),
          ),
          deck.maxHypotheses,
        )
      : undefined;

  const placement = resolvePlacement(options.placement, remainingLength, bounds, deck.random);
  const reordered =
    order === "random" && selected.instanceIds.length > 1
      ? shuffleValues(
          selected.instanceIds,
          placement.random === undefined
            ? fail("RANDOM_SOURCE_REQUIRED", "This operation requires a random source.")
            : placement.random,
        )
      : Object.freeze({
          values: Object.freeze([...selected.instanceIds]),
          random: placement.random,
          decisions: Object.freeze([]),
        });
  const selectedIndexSet = new Set(selected.indices);
  const remaining = deck.active.filter((_instanceId, index) => !selectedIndexSet.has(index));
  const active = insertAt(remaining, placement.gap, reordered.values);

  let knowledge = hiddenKnowledge;
  if (knowledge === undefined && selected.kind === "indices") {
    const orderOffsets = reordered.values.map((instanceId) => {
      const offset = selected.instanceIds.indexOf(instanceId);
      /* v8 ignore next -- Fisher-Yates only permutes IDs from the selected source array */
      if (offset === -1) {
        throw new Error("A moved instance is missing from its source selection.");
      }
      return offset;
    });
    knowledge = moveKnowledgeByIndicesOrdered(
      revealedBase,
      selected.indices,
      placement.gap,
      orderOffsets,
      deck.maxHypotheses,
    );
  } else if (knowledge === undefined) {
    knowledge = insertKnownKnowledge(
      revealedBase,
      placement.gap,
      reordered.values,
      false,
      deck.maxHypotheses,
    );
  }

  const requestSelection: JsonObject =
    options.selection.kind === "indices"
      ? Object.freeze({
          kind: options.selection.kind,
          indices: Object.freeze([...options.selection.indices]),
        })
      : Object.freeze({
          kind: options.selection.kind,
          instanceIds: Object.freeze([...options.selection.instanceIds]),
        });
  const request = Object.freeze({
    selection: requestSelection,
    placement: placementJson(options.placement),
    order,
    visibility,
    bounds,
  });
  const resolution = Object.freeze({
    sourceIndices: Object.freeze([...selected.indices]),
    appliedGap: placement.gap,
    referenceLength: remainingLength,
    wasClamped: placement.wasClamped,
    instanceIds: Object.freeze([...reordered.values]),
    randomDecisions: Object.freeze([
      ...(placement.decision === undefined ? [] : [decisionJson(placement.decision)]),
      ...decisionsJson(reordered.decisions),
    ]),
  });
  const hiddenGap = options.placement.kind === "random-within" && placementChoices.gaps.length > 1;
  const hiddenOrder = order === "random" && selected.instanceIds.length > 1;
  const observerDetails = Object.freeze({
    sourceIndices:
      visibility === "revealed" || selected.kind === "indices"
        ? Object.freeze([...selected.indices])
        : null,
    appliedGap: visibility === "revealed" || !hiddenGap ? placement.gap : null,
    referenceLength: remainingLength,
    wasClamped: placement.wasClamped,
    instanceIds:
      visibility === "revealed" || !hiddenOrder
        ? Object.freeze([...reordered.values])
        : Object.freeze([...selected.instanceIds]),
  });
  const output: MoveOutput = Object.freeze({
    instanceIds: Object.freeze([...reordered.values]),
    requestedPlacement: Object.freeze({ ...options.placement }),
    appliedGap: placement.gap,
    referenceLength: remainingLength,
    wasClamped: placement.wasClamped,
  });
  return commit(
    deck,
    "cards.moved",
    request,
    resolution,
    observerDetails,
    { active, knowledge, random: reordered.random },
    output,
  );
}

export function drawCards<TCard>(
  publicDeck: Deck<TCard>,
  options: DrawOptions = {},
): OperationResult<TCard, DrawOutput<TCard>> {
  const deck = asInternalDeck(publicDeck);
  const count = options.count ?? 1;
  const reveal = options.reveal ?? true;
  if (!Number.isSafeInteger(count) || count < 1) {
    fail("INVALID_COUNT", "Draw count must be a positive safe integer.", { count });
  }
  if (count > deck.active.length) {
    fail("INVALID_COUNT", "Draw count exceeds the active deck length.", {
      count,
      length: deck.active.length,
    });
  }
  const drawnIds = deck.active.slice(0, count);
  const active = Object.freeze(deck.active.slice(count));
  const priorDrawnLength = deck.drawn.length;
  const drawn = Object.freeze([...deck.drawn, ...drawnIds]);
  let knowledge = drawKnowledge(deck.knowledge, count);
  if (reveal) {
    drawnIds.forEach((instanceId, offset) => {
      knowledge = conditionKnowledgeExact(
        knowledge,
        "drawn",
        priorDrawnLength + offset,
        instanceId,
        deck.maxHypotheses,
      );
    });
  }
  const instances = Object.freeze(
    drawnIds.map((instanceId) => requireInstance(deck.instances, instanceId)),
  );
  const request = Object.freeze({ count, reveal });
  const resolution = Object.freeze({ instanceIds: Object.freeze([...drawnIds]) });
  const observerDetails = Object.freeze({
    count,
    instanceIds: reveal ? Object.freeze([...drawnIds]) : null,
  });
  const output: DrawOutput<TCard> = Object.freeze({ instances, revealed: reveal });
  return commit(
    deck,
    "cards.drawn",
    request,
    resolution,
    observerDetails,
    { active, drawn, knowledge },
    output,
  );
}

export function observe<TCard>(
  publicDeck: Deck<TCard>,
  observation: Observation,
): OperationResult<TCard, ObservationOutput> {
  const deck = asInternalDeck(publicDeck);
  const actualId = actualLocationId(deck, observation.location);
  let knowledge;

  if (observation.evidence.kind === "instance") {
    requireInstance(deck.instances, observation.evidence.instanceId);
    if (observation.evidence.instanceId !== actualId) {
      fail("IMPOSSIBLE_OBSERVATION", "Observed instance does not occupy the supplied location.", {
        actualInstanceId: actualId,
        observedInstanceId: observation.evidence.instanceId,
      });
    }
    knowledge = conditionKnowledgeExact(
      deck.knowledge,
      observation.location.zone,
      observation.location.index,
      actualId,
      deck.maxHypotheses,
    );
  } else {
    const target = observation.evidence.target;
    validateTarget(target, deck.config, deck.instances);
    const actual = requireInstance(deck.instances, actualId);
    const actualMatch = instanceMatchesTarget(actual, target);
    if (actualMatch !== observation.evidence.matches) {
      fail("IMPOSSIBLE_OBSERVATION", "Target evidence contradicts the concrete card.", {
        actualInstanceId: actualId,
        observedMatches: observation.evidence.matches,
      });
    }
    const matchingIds = new Set(
      [...deck.instances.values()]
        .filter((instance) => instanceMatchesTarget(instance, target))
        .map((instance) => instance.instanceId),
    );
    knowledge = conditionKnowledgeTarget(
      deck.knowledge,
      observation.location.zone,
      observation.location.index,
      matchingIds,
      observation.evidence.matches,
      deck.maxHypotheses,
    );
  }

  const details = Object.freeze({
    location: locationJson(observation.location),
    evidence: evidenceJson(observation.evidence),
  });
  const output: ObservationOutput = Object.freeze({
    location: Object.freeze({ ...observation.location }),
    evidence: observation.evidence,
  });
  return commit(
    deck,
    "card.observed",
    details,
    Object.freeze({ actualInstanceId: actualId }),
    details,
    { knowledge },
    output,
  );
}
