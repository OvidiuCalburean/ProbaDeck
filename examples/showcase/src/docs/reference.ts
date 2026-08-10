export interface ApiParameter {
  readonly name: string;
  readonly type: string;
  readonly defaultValue?: string;
  readonly description: string;
}

export interface ApiEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: "Function" | "Class";
  readonly signature: string;
  readonly summary: string;
  readonly parameters: readonly ApiParameter[];
  readonly returns: string;
  readonly example?: string;
  readonly notes?: readonly string[];
}

export interface ApiGroup {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly entries: readonly ApiEntry[];
}

export interface TypeEntry {
  readonly name: string;
  readonly definition: string;
  readonly description: string;
}

export interface TypeGroup {
  readonly label: string;
  readonly entries: readonly TypeEntry[];
}

export const apiGroups: readonly ApiGroup[] = [
  {
    id: "deck-state",
    label: "Deck state",
    description: "Create a typed deck and read either of its two card zones without mutation.",
    entries: [
      {
        id: "create-deck",
        name: "createDeck",
        kind: "Function",
        signature: "createDeck<TCard>(options: CreateDeckOptions<TCard>): Deck<TCard>",
        summary:
          "Creates the initial immutable deck. Cards are arbitrary caller-defined values; cardKey and classifiers give the engine the stable identities it needs for targeting and probability queries.",
        parameters: [
          {
            name: "options.cards",
            type: "readonly TCard[]",
            description:
              "Cards in top-to-bottom active order. Every entry becomes a unique instance.",
          },
          {
            name: "options.config",
            type: "DeckConfig<TCard>",
            description: "Defines the logical card key and optional named classifiers.",
          },
          {
            name: "options.instanceIds",
            type: "readonly string[]",
            defaultValue: '"instance-1", …',
            description: "Optional stable IDs. When supplied, its length must match cards.",
          },
          {
            name: "options.random",
            type: "RandomSource",
            description: "Seeded or custom source used by later random operations.",
          },
          {
            name: "options.maxHypotheses",
            type: "number",
            defaultValue: "10,000",
            description: "Hard ceiling for exact observer-knowledge hypotheses.",
          },
        ],
        returns: "A revision-0 Deck whose active length equals cards.length and drawnCount is 0.",
        example: `type Card = { rank: string; suit: string };

const deck = createDeck<Card>({
  cards,
  config: {
    cardKey: (card) => card.rank + "-" + card.suit,
    classifiers: {
      suit: (card) => card.suit,
      color: (card) => card.suit === "heart" || card.suit === "diamond"
        ? "red"
        : "black",
    },
  },
  random: createSeededRandom({ seed: 42n }),
});`,
        notes: [
          "Classifier outputs are normalized to sorted, deduplicated string arrays.",
          "Invalid metadata or duplicate instance IDs fail before a deck is created.",
        ],
      },
      {
        id: "get-active-cards",
        name: "getActiveCards",
        kind: "Function",
        signature: "getActiveCards<TCard>(deck: Deck<TCard>): readonly CardInstance<TCard>[]",
        summary: "Reads the active draw pile in top-to-bottom order.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to inspect." },
        ],
        returns:
          "A frozen array of card instances. Reading it does not change revision or knowledge.",
        example: `const activeCards = getActiveCards(deck);

const topCard = activeCards[0];
console.log(topCard.instanceId, topCard.card);`,
      },
      {
        id: "get-drawn-cards",
        name: "getDrawnCards",
        kind: "Function",
        signature: "getDrawnCards<TCard>(deck: Deck<TCard>): readonly CardInstance<TCard>[]",
        summary: "Reads cards already removed from the active pile, in draw order.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to inspect." },
        ],
        returns: "A frozen array of drawn card instances.",
        example: `const drawnCards = getDrawnCards(deck);

for (const instance of drawnCards) {
  console.log(instance.instanceId, instance.cardKey);
}`,
      },
      {
        id: "get-knowledge-complexity",
        name: "getKnowledgeComplexity",
        kind: "Function",
        signature: "getKnowledgeComplexity<TCard>(deck: Deck<TCard>): KnowledgeComplexity",
        summary:
          "Reports the current exact observer-hypothesis usage so applications can surface inference headroom before a complex hidden operation.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to inspect." },
        ],
        returns:
          "A frozen object containing hypothesisCount, maxHypotheses, remainingCapacity, and utilization.",
        example: `const complexity = getKnowledgeComplexity(deck);

console.log(
  \`\${complexity.hypothesisCount}/\${complexity.maxHypotheses} hypotheses\`,
);`,
        notes: [
          "This reports the current exact state; an operation that exceeds the limit still fails atomically with a projected count and recommended actions.",
        ],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    description:
      "Shuffle, insert, move, draw, and add evidence. Every success returns a new deck, output, and audit event.",
    entries: [
      {
        id: "shuffle-deck",
        name: "shuffleDeck",
        kind: "Function",
        signature:
          "shuffleDeck<TCard>(deck: Deck<TCard>, options?: ShuffleOptions): OperationResult<TCard, ShuffleOutput>",
        summary:
          "Applies an unbiased Fisher–Yates shuffle to the whole active deck or a half-open region.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to transform." },
          {
            name: "options.region",
            type: "IndexRange",
            defaultValue: "whole active deck",
            description: "Zero-based startIndex inclusive and endIndexExclusive exclusive.",
          },
          {
            name: "options.visibility",
            type: '"hidden" | "revealed"',
            defaultValue: '"hidden"',
            description: "Controls whether the resolved order becomes observer knowledge.",
          },
          {
            name: "options.bounds",
            type: '"error" | "clamp"',
            defaultValue: '"error"',
            description: "Rejects invalid bounds or clamps them and reports wasClamped.",
          },
        ],
        returns:
          "OperationResult containing the applied region, reference length, and clamp status.",
        example: `const { deck: shuffled, output, event } = shuffleDeck(deck, {
  region: { startIndex: 0, endIndexExclusive: 20 },
  visibility: "hidden",
});`,
        notes: [
          "A RandomSource is required only when the selected region contains more than one card.",
          "Hidden random outcomes expand exact observer hypotheses; revealed outcomes do not stay hidden.",
        ],
      },
      {
        id: "insert-cards",
        name: "insertCards",
        kind: "Function",
        signature:
          "insertCards<TCard>(deck: Deck<TCard>, options: InsertOptions<TCard>): OperationResult<TCard, InsertOutput<TCard>>",
        summary:
          "Adds new cards or returns drawn instances to an insertion gap in the active deck.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to transform." },
          {
            name: "options.items",
            type: "readonly InsertItem<TCard>[]",
            description:
              'One or more { kind: "new", card } or { kind: "drawn", instanceId } items.',
          },
          {
            name: "options.placement",
            type: "Placement",
            description: "Top, bottom, exact gap index, or an inclusive random gap range.",
          },
          {
            name: "options.order",
            type: '"preserve" | "random"',
            defaultValue: '"preserve"',
            description: "Keeps input order or randomizes the inserted group.",
          },
          {
            name: "options.visibility",
            type: "Visibility",
            defaultValue: '"hidden"',
            description: "Controls whether the resolved insertion is known to the observer.",
          },
          {
            name: "options.bounds",
            type: "BoundsBehavior",
            defaultValue: '"error"',
            description: "Rejects or clamps an out-of-bounds placement.",
          },
        ],
        returns:
          "OperationResult with inserted instances, applied gap, reference length, and clamp status.",
        example: `const { deck: returned } = insertCards(deck, {
  items: [{ kind: "drawn", instanceId: "ace-of-hearts-1" }],
  placement: { kind: "from-bottom", offset: 0 },
  visibility: "hidden",
});`,
        notes: [
          "A drawn item must currently be in the drawn zone; each item may appear only once.",
          "Random order or random placement needs a RandomSource when more than one outcome exists.",
        ],
      },
      {
        id: "move-cards",
        name: "moveCards",
        kind: "Function",
        signature:
          "moveCards<TCard>(deck: Deck<TCard>, options: MoveOptions): OperationResult<TCard, MoveOutput>",
        summary: "Repositions active cards selected by pre-operation indices or instance IDs.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to transform." },
          {
            name: "options.selection",
            type: "MoveSelection",
            description: "A list of zero-based active indices or active instance IDs.",
          },
          {
            name: "options.placement",
            type: "Placement",
            description: "Insertion gap resolved after selected cards have been removed.",
          },
          {
            name: "options.order",
            type: "OrderMode",
            defaultValue: '"preserve"',
            description: "Preserves selected order or randomizes it.",
          },
          {
            name: "options.visibility",
            type: "Visibility",
            defaultValue: '"hidden"',
            description: "Controls observer knowledge of the resolved move.",
          },
          {
            name: "options.bounds",
            type: "BoundsBehavior",
            defaultValue: '"error"',
            description: "Rejects or clamps an out-of-bounds placement.",
          },
        ],
        returns:
          "OperationResult with moved IDs, applied gap, post-removal reference length, and clamp status.",
        example: `const { deck: cut } = moveCards(deck, {
  selection: { kind: "indices", indices: [0, 1, 2] },
  placement: { kind: "from-bottom", offset: 0 },
});`,
      },
      {
        id: "draw-cards",
        name: "drawCards",
        kind: "Function",
        signature:
          "drawCards<TCard>(deck: Deck<TCard>, options?: DrawOptions): OperationResult<TCard, DrawOutput<TCard>>",
        summary: "Moves one or more cards from the top of the active pile to the drawn zone.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to transform." },
          {
            name: "options.count",
            type: "number",
            defaultValue: "1",
            description: "Positive safe integer no greater than the active length.",
          },
          {
            name: "options.reveal",
            type: "boolean",
            defaultValue: "true",
            description: "When true, the drawn identities become observer knowledge.",
          },
        ],
        returns: "OperationResult containing the drawn instances and whether they were revealed.",
        example: `const { deck: afterHand, output } = drawCards(deck, {
  count: 5,
  reveal: true,
});`,
      },
      {
        id: "observe",
        name: "observe",
        kind: "Function",
        signature:
          "observe<TCard>(deck: Deck<TCard>, observation: Observation): OperationResult<TCard, ObservationOutput>",
        summary:
          "Conditions observer knowledge with evidence about an active or drawn location without moving a card.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to condition." },
          {
            name: "observation.location",
            type: "Location",
            description: 'A zero-based index in the "active" or "drawn" zone.',
          },
          {
            name: "observation.evidence",
            type: "ObservationEvidence",
            description: "An exact instance, or a target plus whether the location matches it.",
          },
        ],
        returns: "OperationResult echoing the accepted location and evidence.",
        example: `const { deck: conditioned } = observe(deck, {
  location: { zone: "active", index: 0 },
  evidence: {
    kind: "target",
    target: { kind: "classifier", classifier: "suit", value: "heart" },
    matches: false,
  },
});`,
        notes: [
          "Evidence is checked against the concrete deck. Contradictory evidence throws IMPOSSIBLE_OBSERVATION.",
        ],
      },
    ],
  },
  {
    id: "probability",
    label: "Probability",
    description:
      "Ask three precisely different questions. Results include reduced fractions and structured proof data.",
    entries: [
      {
        id: "probability-of-next",
        name: "probabilityOfNext",
        kind: "Function",
        signature:
          "probabilityOfNext<TCard>(deck: Deck<TCard>, target: CardTarget): ProbabilityResult",
        summary: "Returns the probability that the next active card matches a target.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The knowledge snapshot to query." },
          { name: "target", type: "CardTarget", description: "The card predicate to evaluate." },
        ],
        returns: "Exact fraction, decimal, percentage, and a ProbabilityExplanation.",
        example: `const result = probabilityOfNext(deck, {
  kind: "classifier",
  classifier: "suit",
  value: "heart",
});

result.exact;      // { numerator: 10n, denominator: 47n }
result.percentage; // 21.276…`,
      },
      {
        id: "probability-at-draw",
        name: "probabilityAtDraw",
        kind: "Function",
        signature:
          "probabilityAtDraw<TCard>(deck: Deck<TCard>, target: CardTarget, drawNumber: number): ProbabilityResult",
        summary: "Returns the probability of a match at exactly one 1-based future draw number.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The knowledge snapshot to query." },
          { name: "target", type: "CardTarget", description: "The card predicate to evaluate." },
          {
            name: "drawNumber",
            type: "number",
            description: "A 1-based active-deck position between 1 and deck.length.",
          },
        ],
        returns: "Exact fraction, decimal, percentage, and a ProbabilityExplanation.",
        example: `const result = probabilityAtDraw(
  deck,
  { kind: "classifier", classifier: "rarity", value: "rare" },
  5,
);

console.log(result.exact);      // exact probability at draw 5
console.log(result.percentage);`,
        notes: ["This query does not condition on misses in the preceding draws."],
      },
      {
        id: "probability-within-draws",
        name: "probabilityWithinDraws",
        kind: "Function",
        signature:
          "probabilityWithinDraws<TCard>(deck: Deck<TCard>, target: CardTarget, drawCount: number): ProbabilityResult",
        summary: "Returns the probability of at least one match in the next N draws.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The knowledge snapshot to query." },
          { name: "target", type: "CardTarget", description: "The card predicate to evaluate." },
          {
            name: "drawCount",
            type: "number",
            description: "An integer from 0 through deck.length. Zero returns exactly 0/1.",
          },
        ],
        returns: "Exact fraction, decimal, percentage, and a ProbabilityExplanation.",
        example: `const result = probabilityWithinDraws(
  deck,
  { kind: "card-key", cardKey: "ace" },
  3,
);`,
      },
    ],
  },
  {
    id: "randomness",
    label: "Randomness",
    description:
      "Use portable PCG32 or supply your own immutable source. ProbaDeck never reads Math.random().",
    entries: [
      {
        id: "create-seeded-random",
        name: "createSeededRandom",
        kind: "Function",
        signature:
          "createSeededRandom(options: { seed: bigint | string; stream?: bigint | string }): RandomSource",
        summary: "Creates a deterministic PCG32 source compatible with the portable v1 contract.",
        parameters: [
          {
            name: "options.seed",
            type: "bigint | string",
            description: "Unsigned 64-bit seed, as a bigint or base-10 string.",
          },
          {
            name: "options.stream",
            type: "bigint | string",
            defaultValue: "1",
            description: "Unsigned 64-bit stream selector for independent deterministic sequences.",
          },
        ],
        returns: 'A RandomSource whose algorithm is "pcg32-v1".',
        example: `const random = createSeededRandom({
  seed: "18446744073709551615",
  stream: 7n,
});`,
      },
      {
        id: "pcg32-random",
        name: "Pcg32Random",
        kind: "Class",
        signature: "new Pcg32Random(state: bigint, increment: bigint) implements RandomSource",
        summary:
          "Low-level immutable PCG32 state. Prefer createSeededRandom unless restoring a known state.",
        parameters: [
          { name: "state", type: "bigint", description: "Internal 64-bit generator state." },
          {
            name: "increment",
            type: "bigint",
            description: "Internal 64-bit stream increment.",
          },
        ],
        returns:
          "nextUint32() returns { value, next }, where value is uint32 and next is a new Pcg32Random.",
        example: `const random = new Pcg32Random(42n, 3n);
const { value, next } = random.nextUint32();

console.log(value);          // one uint32 value
console.log(next.algorithm); // "pcg32-v1"`,
        notes: ["The instance is frozen; generating a value never mutates the current source."],
      },
    ],
  },
  {
    id: "events",
    label: "Events & logs",
    description:
      "Inspect privileged deterministic decisions separately from the observer-safe projection.",
    entries: [
      {
        id: "get-audit-log",
        name: "getAuditLog",
        kind: "Function",
        signature: "getAuditLog<TCard>(deck: Deck<TCard>): readonly AuditEvent[]",
        summary:
          "Returns the privileged event stream, including operation requests and resolved hidden outcomes.",
        parameters: [
          {
            name: "deck",
            type: "Deck<TCard>",
            description: "The snapshot whose history to inspect.",
          },
        ],
        returns: "Frozen AuditEvent entries with contiguous sequence and revision values.",
        example: `const auditLog = getAuditLog(deck);
const latest = auditLog.at(-1);

console.log(latest?.kind);
console.log(latest?.resolution); // includes privileged resolution data`,
        notes: [
          "Reading the audit log never reveals its hidden details to modeled observer knowledge.",
        ],
      },
      {
        id: "get-observer-log",
        name: "getObserverLog",
        kind: "Function",
        signature: "getObserverLog<TCard>(deck: Deck<TCard>): readonly ObserverEvent[]",
        summary: "Returns the redacted event projection safe for the modeled observer.",
        parameters: [
          {
            name: "deck",
            type: "Deck<TCard>",
            description: "The snapshot whose history to inspect.",
          },
        ],
        returns: "Frozen ObserverEvent entries with visible details only.",
        example: `const observerLog = getObserverLog(deck);

for (const event of observerLog) {
  console.log(event.sequence, event.kind, event.details);
}`,
      },
    ],
  },
  {
    id: "persistence",
    label: "Persistence & replay",
    description:
      "Encode caller-owned cards explicitly, restore snapshots, and replay recorded resolutions without rerolling.",
    entries: [
      {
        id: "serialize-snapshot",
        name: "serializeSnapshot",
        kind: "Function",
        signature:
          "serializeSnapshot<TCard>(deck: Deck<TCard>, codec: CardCodec<TCard>): JsonObject",
        summary: "Serializes current deck state, knowledge, history, and supported random state.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The snapshot to serialize." },
          {
            name: "codec",
            type: "CardCodec<TCard>",
            description: "Caller-owned encode/decode rules for card data.",
          },
        ],
        returns: "A schema-versioned JSON-compatible object. bigint values are base-10 strings.",
        example: `const codec = {
  encode: (card: Card) => card,
  decode: (value) => value as Card,
};

const json = serializeSnapshot(deck, codec);`,
      },
      {
        id: "restore-snapshot",
        name: "restoreSnapshot",
        kind: "Function",
        signature:
          "restoreSnapshot<TCard>(value: JsonValue, options: RestoreOptions<TCard>): Deck<TCard>",
        summary: "Validates and restores a serialized snapshot using live config callbacks.",
        parameters: [
          { name: "value", type: "JsonValue", description: "The serialized snapshot." },
          {
            name: "options.config",
            type: "DeckConfig<TCard>",
            description: "Live key/classifier callbacks, which are never serialized.",
          },
          {
            name: "options.codec",
            type: "CardCodec<TCard>",
            description: "Decodes serialized card values.",
          },
          {
            name: "options.random",
            type: "RandomSource",
            description: "Optional replacement for a nonportable custom random source.",
          },
        ],
        returns: "A validated Deck with its saved revision and history.",
        example: `const restored = restoreSnapshot(snapshot, {
  config,
  codec,
});

console.log(restored.revision, restored.length);`,
        notes: [
          "Card keys and classifiers are recomputed; a mismatch throws CARD_METADATA_MISMATCH.",
          "Built-in PCG32 state resumes automatically. Custom random state needs a replacement source for later random operations.",
        ],
      },
      {
        id: "serialize-event-log",
        name: "serializeEventLog",
        kind: "Function",
        signature:
          "serializeEventLog<TCard>(deck: Deck<TCard>, codec: CardCodec<TCard>): JsonObject",
        summary: "Creates a schema-versioned replay envelope from a deck and its audit history.",
        parameters: [
          { name: "deck", type: "Deck<TCard>", description: "The final snapshot to package." },
          {
            name: "codec",
            type: "CardCodec<TCard>",
            description: "Encodes caller-owned card values.",
          },
        ],
        returns: "A JSON-compatible event-log envelope containing the serialized final snapshot.",
        example: `const eventLog = serializeEventLog(deck, codec);
const stored = JSON.stringify(eventLog);

localStorage.setItem("probadeck-replay", stored);`,
      },
      {
        id: "replay-event-log",
        name: "replayEventLog",
        kind: "Function",
        signature:
          "replayEventLog<TCard>(value: JsonValue, options: ReplayOptions<TCard>): Deck<TCard>",
        summary:
          "Rebuilds state by applying recorded resolutions instead of consuming new randomness.",
        parameters: [
          { name: "value", type: "JsonValue", description: "The serialized event-log envelope." },
          {
            name: "options.config",
            type: "DeckConfig<TCard>",
            description: "Live card metadata callbacks.",
          },
          { name: "options.codec", type: "CardCodec<TCard>", description: "Decodes card values." },
          {
            name: "options.random",
            type: "RandomSource",
            description: "Optional custom source replacement.",
          },
          {
            name: "options.throughSequence",
            type: "number",
            defaultValue: "last sequence",
            description: "Zero-based inclusive event sequence to stop after.",
          },
        ],
        returns: "The replayed Deck at the requested sequence.",
        example: `const replayed = replayEventLog(eventLog, {
  config,
  codec,
  throughSequence: 3,
});

console.log(replayed.revision); // state after event sequence 3`,
        notes: [
          "A full replay compares the rebuilt result with recorded final state and throws REPLAY_DIVERGENCE on mismatch.",
        ],
      },
    ],
  },
  {
    id: "errors",
    label: "Errors",
    description: "Handle stable machine-readable error codes while retaining human context.",
    entries: [
      {
        id: "probadeck-error",
        name: "ProbaDeckError",
        kind: "Class",
        signature:
          "new ProbaDeckError(code: ProbaDeckErrorCode, message: string, details?: JsonObject, cause?: unknown)",
        summary:
          "The error class thrown by public operations for invalid input, impossible evidence, limits, or invalid persistence data.",
        parameters: [
          {
            name: "code",
            type: "ProbaDeckErrorCode",
            description: "Stable programmatic failure category.",
          },
          { name: "message", type: "string", description: "Human-readable description." },
          {
            name: "details",
            type: "JsonObject",
            defaultValue: "{}",
            description: "Structured diagnostic context.",
          },
          { name: "cause", type: "unknown", description: "Optional underlying error cause." },
        ],
        returns: "An Error with name, code, message, details, and optional cause.",
        example: `try {
  drawCards(deck, { count: 999 });
} catch (error) {
  if (error instanceof ProbaDeckError) {
    console.error(error.code, error.details);
  }
}`,
        notes: ["Failed operations do not mutate the input deck or consume randomness."],
      },
    ],
  },
];

export const typeGroups: readonly TypeGroup[] = [
  {
    label: "JSON & exact values",
    entries: [
      {
        name: "JsonPrimitive",
        definition: "null | boolean | number | string",
        description: "JSON scalar value.",
      },
      {
        name: "JsonValue",
        definition: "JsonPrimitive | readonly JsonValue[] | object",
        description: "Recursive JSON-compatible value.",
      },
      {
        name: "JsonObject",
        definition: "Readonly<Record<string, JsonValue>>",
        description: "Immutable JSON object.",
      },
      {
        name: "ExactFraction",
        definition: "{ numerator: bigint; denominator: bigint }",
        description: "Reduced exact rational value.",
      },
    ],
  },
  {
    label: "Deck model",
    entries: [
      {
        name: "Classifier<TCard>",
        definition: "(card: TCard) => string | readonly string[]",
        description: "Maps a card to one or more values for a named category.",
      },
      {
        name: "DeckConfig<TCard>",
        definition: "{ cardKey; classifiers? }",
        description: "Caller-owned card identity and classification callbacks.",
      },
      {
        name: "CardInstance<TCard>",
        definition: "{ instanceId; card; cardKey; classifiers }",
        description: "Unique physical instance plus normalized metadata.",
      },
      {
        name: "Deck<TCard>",
        definition: "{ revision; length; drawnCount; maxHypotheses }",
        description: "Opaque immutable snapshot with public counters.",
      },
      {
        name: "KnowledgeComplexity",
        definition: "{ hypothesisCount; maxHypotheses; remainingCapacity; utilization }",
        description: "Current exact-inference usage and remaining hypothesis capacity.",
      },
      {
        name: "CreateDeckOptions<TCard>",
        definition: "{ cards; config; instanceIds?; random?; maxHypotheses? }",
        description: "Inputs accepted by createDeck.",
      },
    ],
  },
  {
    label: "Randomness",
    entries: [
      {
        name: "RandomStep",
        definition: "{ value: number; next: RandomSource }",
        description: "One uint32 result and the next immutable source.",
      },
      {
        name: "RandomSource",
        definition: "{ algorithm: string; nextUint32(): RandomStep }",
        description: "Injectable random-source contract.",
      },
      {
        name: "RandomDecision",
        definition: "{ upperExclusive; words; value }",
        description: "Auditable bounded random choice.",
      },
    ],
  },
  {
    label: "Placement & targeting",
    entries: [
      {
        name: "Visibility",
        definition: '"hidden" | "revealed"',
        description: "Whether a resolved operation is known to the observer.",
      },
      {
        name: "BoundsBehavior",
        definition: '"error" | "clamp"',
        description: "Out-of-bounds resolution policy.",
      },
      {
        name: "OrderMode",
        definition: '"preserve" | "random"',
        description: "Ordering policy for a moved or inserted group.",
      },
      {
        name: "IndexRange",
        definition: "{ startIndex; endIndexExclusive }",
        description: "Zero-based half-open active-deck range.",
      },
      {
        name: "Placement",
        definition: '"index" | "from-top" | "from-bottom" | "random-within"',
        description: "Insertion-gap addressing variants.",
      },
      {
        name: "CardTarget",
        definition: '"instance" | "card-key" | "classifier" | "all" | "any" | "not"',
        description: "Composable predicate used by observations and queries.",
      },
    ],
  },
  {
    label: "Probability",
    entries: [
      {
        name: "ProbabilityQuery",
        definition: '"next" | "at-draw" | "within-draws"',
        description: "Normalized query stored in an explanation.",
      },
      {
        name: "CalculationNode",
        definition:
          '"constant" | "ratio" | "hypergeometric-no-hit" | "product" | "complement" | "weighted-sum"',
        description: "Recursive machine-readable formula tree.",
      },
      {
        name: "HypothesisExplanation",
        definition: "{ weight; conditionalProbability; formula }",
        description: "One observer hypothesis contribution.",
      },
      {
        name: "InstanceDispositionReason",
        definition:
          '"candidate" | "deterministic-hit" | "drawn" | "outside-query" | "no-queried-pool-location"',
        description: "Why an instance did or did not contribute.",
      },
      {
        name: "InstanceDisposition",
        definition: "{ instanceId; reason }",
        description: "Per-instance explanation entry.",
      },
      {
        name: "ProbabilityExplanation",
        definition:
          "{ schemaVersion; revision; query; target; result; formula; hypotheses; matchingInstances }",
        description: "Structured proof for a probability result.",
      },
      {
        name: "ProbabilityResult",
        definition: "{ exact; decimal; percentage; explanation }",
        description: "Complete public query result.",
      },
    ],
  },
  {
    label: "Events & operation results",
    entries: [
      {
        name: "ObserverEvent",
        definition: "{ schemaVersion; sequence; revision; kind; details }",
        description: "Observer-safe event projection.",
      },
      {
        name: "AuditEvent",
        definition: "{ schemaVersion; sequence; revision; kind; request; resolution; observation }",
        description: "Privileged deterministic event record.",
      },
      {
        name: "OperationResult<TCard, TOutput>",
        definition: "{ deck; output; event }",
        description: "Immutable transition return shape.",
      },
    ],
  },
  {
    label: "Operation options & outputs",
    entries: [
      {
        name: "ShuffleOptions",
        definition: "{ region?; visibility?; bounds? }",
        description: "Options accepted by shuffleDeck.",
      },
      {
        name: "ShuffleOutput",
        definition: "{ requestedRegion; region; referenceLength; wasClamped }",
        description: "Resolved shuffle details.",
      },
      {
        name: "InsertItem<TCard>",
        definition: '"new" card | "drawn" instance',
        description: "A card source for insertCards.",
      },
      {
        name: "InsertOptions<TCard>",
        definition: "{ items; placement; order?; visibility?; bounds? }",
        description: "Options accepted by insertCards.",
      },
      {
        name: "InsertOutput<TCard>",
        definition: "{ instances; requestedPlacement; appliedGap; referenceLength; wasClamped }",
        description: "Resolved insert details.",
      },
      {
        name: "MoveSelection",
        definition: '"indices" | "instances"',
        description: "How moveCards selects active cards.",
      },
      {
        name: "MoveOptions",
        definition: "{ selection; placement; order?; visibility?; bounds? }",
        description: "Options accepted by moveCards.",
      },
      {
        name: "MoveOutput",
        definition: "{ instanceIds; requestedPlacement; appliedGap; referenceLength; wasClamped }",
        description: "Resolved move details.",
      },
      {
        name: "DrawOptions",
        definition: "{ count?; reveal? }",
        description: "Options accepted by drawCards.",
      },
      {
        name: "DrawOutput<TCard>",
        definition: "{ instances; revealed }",
        description: "Resolved draw details.",
      },
    ],
  },
  {
    label: "Observation",
    entries: [
      {
        name: "Location",
        definition: '{ zone: "active" | "drawn"; index: number }',
        description: "Zero-based location in one deck zone.",
      },
      {
        name: "ObservationEvidence",
        definition: '"instance" | "target" with matches',
        description: "Evidence used to condition knowledge.",
      },
      {
        name: "Observation",
        definition: "{ location; evidence }",
        description: "Input accepted by observe.",
      },
      {
        name: "ObservationOutput",
        definition: "{ location; evidence }",
        description: "Accepted evidence returned by observe.",
      },
    ],
  },
  {
    label: "Persistence & errors",
    entries: [
      {
        name: "CardCodec<TCard>",
        definition: "{ encode(card); decode(value) }",
        description: "Caller-owned card serialization contract.",
      },
      {
        name: "RestoreOptions<TCard>",
        definition: "{ config; codec; random? }",
        description: "Options accepted by restoreSnapshot.",
      },
      {
        name: "ReplayOptions<TCard>",
        definition: "RestoreOptions plus throughSequence?",
        description: "Options accepted by replayEventLog.",
      },
      {
        name: "ProbaDeckErrorCode",
        definition: "20 stable string literals",
        description: "Programmatic failure categories listed below.",
      },
    ],
  },
];

export const errorCodes = [
  ["INVALID_CONFIG", "Missing or invalid deck configuration."],
  ["INVALID_CARD_METADATA", "A card key or classifier returned invalid metadata."],
  ["DUPLICATE_INSTANCE_ID", "Two physical cards would share one instance ID."],
  ["UNKNOWN_INSTANCE", "An instance ID is not registered in the deck."],
  ["INSTANCE_NOT_DRAWN", "An insert requested a card outside the drawn zone."],
  ["INVALID_TARGET", "A CardTarget is malformed."],
  ["UNKNOWN_CLASSIFIER", "A target names a classifier absent from config."],
  ["INVALID_POSITION", "A placement or location is structurally invalid."],
  ["POSITION_OUT_OF_BOUNDS", "A position exceeds valid deck gaps or indices."],
  ["INVALID_REGION", "A shuffle range is structurally invalid."],
  ["INVALID_COUNT", "A count is invalid for the requested operation."],
  ["EMPTY_DECK", "A query requires a next card but the active deck is empty."],
  ["RANDOM_SOURCE_REQUIRED", "A nondeterministic choice has no injected source."],
  ["INVALID_RANDOM_VALUE", "Seed, stream, or custom random output is invalid."],
  [
    "INFERENCE_LIMIT_EXCEEDED",
    "An exact operation would exceed maxHypotheses; details include the projected count and recommended actions.",
  ],
  ["IMPOSSIBLE_OBSERVATION", "Evidence contradicts the concrete deck state."],
  ["INVALID_SERIALIZED_DATA", "Snapshot or event-log data fails validation."],
  ["UNSUPPORTED_SCHEMA_VERSION", "Serialized data uses an unknown schema version."],
  ["CARD_METADATA_MISMATCH", "Restored card metadata differs from live config output."],
  ["REPLAY_DIVERGENCE", "Full replay does not match recorded final state."],
] as const;
