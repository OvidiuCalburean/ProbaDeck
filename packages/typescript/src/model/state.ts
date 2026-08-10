import { normalizeConfig, type NormalizedConfig } from "../config.js";
import { fail } from "../errors.js";
import { createInitialKnowledge, type KnowledgeState } from "../knowledge/state.js";
import type {
  AuditEvent,
  CardInstance,
  CreateDeckOptions,
  Deck,
  JsonObject,
  ObserverEvent,
  RandomSource,
} from "../types.js";
import { createInstanceRegistry } from "./instances.js";

export interface InternalDeck<TCard> extends Deck<TCard> {
  readonly config: NormalizedConfig<TCard>;
  readonly instances: ReadonlyMap<string, CardInstance<TCard>>;
  readonly active: readonly string[];
  readonly drawn: readonly string[];
  readonly nextInstanceNumber: number;
  readonly knowledge: KnowledgeState;
  readonly events: readonly AuditEvent[];
  readonly random: RandomSource | undefined;
}

export interface DeckStateInput<TCard> {
  readonly revision: number;
  readonly config: NormalizedConfig<TCard>;
  readonly instances: ReadonlyMap<string, CardInstance<TCard>>;
  readonly active: readonly string[];
  readonly drawn: readonly string[];
  readonly nextInstanceNumber: number;
  readonly knowledge: KnowledgeState;
  readonly events: readonly AuditEvent[];
  readonly random: RandomSource | undefined;
  readonly maxHypotheses: number;
}

const internalDecks = new WeakSet();

function observerEvent(
  sequence: number,
  revision: number,
  kind: string,
  details: JsonObject,
): ObserverEvent {
  return Object.freeze({ schemaVersion: 1, sequence, revision, kind, details });
}

function validateMaxHypotheses(value: number | undefined): number {
  const maxHypotheses = value ?? 10_000;
  if (!Number.isSafeInteger(maxHypotheses) || maxHypotheses < 1) {
    fail("INVALID_CONFIG", "maxHypotheses must be a positive safe integer.", {
      maxHypotheses,
    });
  }
  return maxHypotheses;
}

export function makeDeck<TCard>(input: DeckStateInput<TCard>): InternalDeck<TCard> {
  const deck: InternalDeck<TCard> = Object.freeze({
    revision: input.revision,
    length: input.active.length,
    drawnCount: input.drawn.length,
    maxHypotheses: input.maxHypotheses,
    config: input.config,
    instances: input.instances,
    active: Object.freeze([...input.active]),
    drawn: Object.freeze([...input.drawn]),
    nextInstanceNumber: input.nextInstanceNumber,
    knowledge: input.knowledge,
    events: Object.freeze([...input.events]),
    random: input.random,
  });
  internalDecks.add(deck);
  return deck;
}

export function createInitialDeck<TCard>(options: CreateDeckOptions<TCard>): InternalDeck<TCard> {
  const config = normalizeConfig(options.config);
  const registry = createInstanceRegistry(options.cards, options.instanceIds, config);
  const active = [...registry.instances.keys()];
  const maxHypotheses = validateMaxHypotheses(options.maxHypotheses);
  const request = Object.freeze({
    instanceIds: Object.freeze(active),
    maxHypotheses,
    randomAlgorithm: options.random?.algorithm ?? null,
  });
  const observation = observerEvent(0, 0, "deck.created", request);
  const event: AuditEvent = Object.freeze({
    schemaVersion: 1,
    sequence: 0,
    revision: 0,
    kind: "deck.created",
    request,
    resolution: Object.freeze({
      active: Object.freeze(active),
      nextInstanceNumber: registry.nextInstanceNumber,
    }),
    observation,
  });

  return makeDeck({
    revision: 0,
    config,
    instances: registry.instances,
    active,
    drawn: [],
    nextInstanceNumber: registry.nextInstanceNumber,
    knowledge: createInitialKnowledge(active),
    events: [event],
    random: options.random,
    maxHypotheses,
  });
}

export function asInternalDeck<TCard>(deck: Deck<TCard>): InternalDeck<TCard> {
  if (!isInternalDeck(deck)) {
    fail("INVALID_CONFIG", "The supplied value is not a ProbaDeck state.");
  }
  return deck;
}

function isInternalDeck<TCard>(deck: Deck<TCard>): deck is InternalDeck<TCard> {
  return typeof deck === "object" && deck !== null && internalDecks.has(deck);
}

export function nextEvent<TCard>(
  deck: InternalDeck<TCard>,
  kind: string,
  request: JsonObject,
  resolution: JsonObject,
  observerDetails: JsonObject,
): AuditEvent {
  const sequence = deck.events.length;
  const revision = deck.revision + 1;
  return Object.freeze({
    schemaVersion: 1,
    sequence,
    revision,
    kind,
    request,
    resolution,
    observation: observerEvent(sequence, revision, kind, observerDetails),
  });
}
