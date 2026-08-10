import {
  createDeck,
  createSeededRandom,
  drawCards,
  getActiveCards,
  insertCards,
  probabilityAtDraw,
  probabilityOfNext,
  probabilityWithinDraws,
  shuffleDeck,
  type CardInstance,
  type CardTarget,
  type Deck,
  type Placement,
  type ProbabilityQuery,
  type ProbabilityResult,
} from "probadeck";

import { holdemDefinition } from "./holdem.js";
import { magicDefinition } from "./magic.js";
import type {
  CardCatalogEntry,
  DemoCard,
  ProbabilityRow,
  ProbabilityView,
  ReturnPlacement,
  ScenarioAction,
  ScenarioDefinition,
  ScenarioEvent,
  ScenarioId,
  ScenarioSession,
} from "./types.js";
import { yugiohDefinition } from "./yugioh.js";

const definitions: Readonly<Record<ScenarioId, ScenarioDefinition>> = {
  holdem: holdemDefinition,
  magic: magicDefinition,
  yugioh: yugiohDefinition,
};

function assertNever(value: never): never {
  throw new Error(`Unsupported scenario value: ${JSON.stringify(value)}`);
}

function expandCatalog(catalog: readonly CardCatalogEntry[]): readonly DemoCard[] {
  return catalog.flatMap((entry) =>
    Array.from({ length: entry.count }, () => {
      const { count: _count, ...card } = entry;
      return card;
    }),
  );
}

function nextEventId(events: readonly ScenarioEvent[]): string {
  return `event-${events.length + 1}`;
}

function event(
  events: readonly ScenarioEvent[],
  title: string,
  detail: string,
  deck: Deck<DemoCard>,
  audit?: ScenarioEvent["audit"],
): ScenarioEvent {
  return {
    id: nextEventId(events),
    title,
    detail,
    revision: deck.revision,
    ...(audit === undefined ? {} : { audit }),
  };
}

function appendEvent(session: ScenarioSession, entry: ScenarioEvent): readonly ScenarioEvent[] {
  return [...session.events, entry];
}

function shuffledDeck(definition: ScenarioDefinition, seed: bigint) {
  const initial = createDeck({
    cards: expandCatalog(definition.catalog),
    config: {
      cardKey: (card) => card.name,
      classifiers: {
        category: (card) => card.category,
        color: (card) => card.color ?? "none",
        game: (card) => card.game,
        rank: (card) => card.rank ?? "none",
        suit: (card) => card.suit ?? "none",
        type: (card) => card.category,
      },
    },
    random: createSeededRandom({ seed }),
  });
  return { initial, shuffled: shuffleDeck(initial) };
}

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return definitions[id];
}

export function createScenarioSession(id: ScenarioId, seed = 42n): ScenarioSession {
  const definition = getScenarioDefinition(id);
  const { initial, shuffled } = shuffledDeck(definition, seed);
  const events: ScenarioEvent[] = [
    event([], "Created deck", `${initial.length} physical cards in supplied order`, initial),
    event(
      [{ id: "event-1", title: "", detail: "", revision: 0 }],
      "Hidden shuffle",
      `PCG32 seed ${seed.toString()} created one uniform pool`,
      shuffled.deck,
      shuffled.event,
    ),
  ];

  if (id === "holdem") {
    const hole = drawCards(shuffled.deck, { count: 2, reveal: true });
    events.push(
      event(
        events,
        "Drew hole cards",
        "Two physical instances revealed to the observer",
        hole.deck,
        hole.event,
      ),
    );
    const flop = drawCards(hole.deck, { count: 3, reveal: true });
    events.push(
      event(
        events,
        "Dealt the flop",
        "Three more instances removed from the eligible deck",
        flop.deck,
        flop.event,
      ),
    );
    return {
      id,
      definition,
      deck: flop.deck,
      zones: { hand: hole.output.instances, community: flop.output.instances },
      events,
      seed,
    };
  }

  const drawCount = id === "magic" ? 7 : 5;
  const openingHand = drawCards(shuffled.deck, { count: drawCount, reveal: true });
  events.push(
    event(
      events,
      "Drew opening hand",
      `${drawCount} physical instances revealed to the observer`,
      openingHand.deck,
      openingHand.event,
    ),
  );
  return {
    id,
    definition,
    deck: openingHand.deck,
    zones: { hand: openingHand.output.instances, community: [] },
    events,
    seed,
  };
}

function draw(session: ScenarioSession): ScenarioSession {
  if (session.id === "holdem" && session.zones.community.length >= 5) {
    throw new Error("Texas Hold'em community cards are capped at five");
  }
  const result = drawCards(session.deck, { count: 1, reveal: true });
  const drawn = result.output.instances[0];
  if (drawn === undefined) {
    throw new Error("The draw operation returned no card");
  }
  const isHoldem = session.id === "holdem";
  const entry = event(
    session.events,
    isHoldem
      ? `Dealt ${session.zones.community.length === 3 ? "the turn" : "the river"}`
      : "Drew a card",
    `${drawn.card.name} revealed; next-card probabilities conditioned`,
    result.deck,
    result.event,
  );
  return {
    ...session,
    deck: result.deck,
    zones: {
      hand: isHoldem ? session.zones.hand : [...session.zones.hand, drawn],
      community: isHoldem ? [...session.zones.community, drawn] : session.zones.community,
    },
    events: appendEvent(session, entry),
  };
}

function resolvePlacement(placement: ReturnPlacement): Placement {
  switch (placement.kind) {
    case "top":
      return { kind: "from-top", offset: 0 };
    case "position":
      return { kind: "index", index: placement.position - 1 };
    case "bottom":
      return { kind: "from-bottom", offset: 0 };
    default:
      return assertNever(placement);
  }
}

function returnCard(
  session: ScenarioSession,
  instanceId: string,
  placement: ReturnPlacement,
): ScenarioSession {
  const returned = session.zones.hand.find((card) => card.instanceId === instanceId);
  if (returned === undefined) {
    throw new Error(`Card instance ${instanceId} is not in the visible hand`);
  }
  const result = insertCards(session.deck, {
    items: [{ kind: "drawn", instanceId }],
    placement: resolvePlacement(placement),
    visibility: "revealed",
    bounds: "clamp",
  });
  const entry = event(
    session.events,
    "Returned a hand card",
    `${returned.card.name} inserted at position ${result.output.appliedGap + 1} from the top`,
    result.deck,
    result.event,
  );
  return {
    ...session,
    deck: result.deck,
    zones: {
      ...session.zones,
      hand: session.zones.hand.filter((card) => card.instanceId !== instanceId),
    },
    events: appendEvent(session, entry),
  };
}

function shuffle(session: ScenarioSession): ScenarioSession {
  const result = shuffleDeck(session.deck, { visibility: "hidden" });
  const entry = event(
    session.events,
    "Shuffled hidden deck",
    `${result.deck.length} active instances merged into a uniform pool`,
    result.deck,
    result.event,
  );
  return {
    ...session,
    deck: result.deck,
    events: appendEvent(session, entry),
  };
}

export function applyScenarioAction(
  session: ScenarioSession,
  action: ScenarioAction,
): ScenarioSession {
  switch (action.kind) {
    case "draw":
      return draw(session);
    case "return-card":
      return returnCard(session, action.instanceId, action.placement);
    case "shuffle":
      return shuffle(session);
    default:
      return assertNever(action);
  }
}

function probability(
  deck: Deck<DemoCard>,
  target: CardTarget,
  query: ProbabilityQuery,
): ProbabilityResult {
  switch (query.kind) {
    case "next":
      return probabilityOfNext(deck, target);
    case "at-draw":
      return probabilityAtDraw(deck, target, query.drawNumber);
    case "within-draws":
      return probabilityWithinDraws(deck, target, query.drawCount);
    default:
      return assertNever(query);
  }
}

export function normalizeQuery(deckLength: number, query: ProbabilityQuery): ProbabilityQuery {
  switch (query.kind) {
    case "next":
      return query;
    case "at-draw":
      return {
        kind: "at-draw",
        drawNumber: Math.max(1, Math.min(query.drawNumber, deckLength)),
      };
    case "within-draws":
      return {
        kind: "within-draws",
        drawCount: Math.max(0, Math.min(query.drawCount, deckLength)),
      };
    default:
      return assertNever(query);
  }
}

function fractionLabel(numerator: bigint, denominator: bigint): string {
  return `${numerator.toString()}/${denominator.toString()}`;
}

export function getProbabilityView(
  session: ScenarioSession,
  requestedQuery: ProbabilityQuery,
): ProbabilityView {
  const query = normalizeQuery(session.deck.length, requestedQuery);
  const rows = session.definition.catalog.map((card): ProbabilityRow => {
    const target = { kind: "card-key", cardKey: card.name } as const;
    const result = probability(session.deck, target, query);
    const remainingCopies = result.explanation.matchingInstances.filter(
      (instance) => instance.reason !== "drawn",
    ).length;
    return {
      target,
      card,
      exact: result.exact,
      exactLabel: fractionLabel(result.exact.numerator, result.exact.denominator),
      percentage: result.percentage,
      totalCopies: card.count,
      remainingCopies,
      explanation: result.explanation,
    };
  });

  if (session.id !== "magic") {
    return { query, rows, classifier: null };
  }

  const landResult = probability(
    session.deck,
    { kind: "classifier", classifier: "type", value: "Land" },
    query,
  );
  return {
    query,
    rows,
    classifier: {
      label: "Land",
      exact: landResult.exact,
      exactLabel: fractionLabel(landResult.exact.numerator, landResult.exact.denominator),
      percentage: landResult.percentage,
      explanation: landResult.explanation,
    },
  };
}

export function getPrivilegedOrder(session: ScenarioSession): readonly CardInstance<DemoCard>[] {
  return getActiveCards(session.deck);
}
