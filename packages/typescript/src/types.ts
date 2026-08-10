export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

export interface ExactFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type Classifier<TCard> = (card: TCard) => string | readonly string[];

export interface DeckConfig<TCard> {
  readonly cardKey: (card: TCard) => string;
  readonly classifiers?: Readonly<Record<string, Classifier<TCard>>>;
}

export interface CardInstance<TCard> {
  readonly instanceId: string;
  readonly card: TCard;
  readonly cardKey: string;
  readonly classifiers: Readonly<Record<string, readonly string[]>>;
}

export interface Deck<TCard> {
  /** Carries the card type without exposing internal state. */
  readonly cardType?: (card: TCard) => TCard;
  readonly revision: number;
  readonly length: number;
  readonly drawnCount: number;
  readonly maxHypotheses: number;
}

export interface RandomStep {
  readonly value: number;
  readonly next: RandomSource;
}

export interface RandomSource {
  readonly algorithm: string;
  nextUint32(): RandomStep;
}

export interface RandomDecision {
  readonly upperExclusive: number;
  readonly words: readonly number[];
  readonly value: number;
}

export type Visibility = "hidden" | "revealed";
export type BoundsBehavior = "error" | "clamp";
export type OrderMode = "preserve" | "random";

export interface IndexRange {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

export type Placement =
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "from-top"; readonly offset: number }
  | { readonly kind: "from-bottom"; readonly offset: number }
  | {
      readonly kind: "random-within";
      readonly startGap: number;
      readonly endGap: number;
    };

export type CardTarget =
  | { readonly kind: "instance"; readonly instanceId: string }
  | { readonly kind: "card-key"; readonly cardKey: string }
  | {
      readonly kind: "classifier";
      readonly classifier: string;
      readonly value: string;
    }
  | { readonly kind: "all"; readonly targets: readonly CardTarget[] }
  | { readonly kind: "any"; readonly targets: readonly CardTarget[] }
  | { readonly kind: "not"; readonly target: CardTarget };

export type ProbabilityQuery =
  | { readonly kind: "next" }
  | { readonly kind: "at-draw"; readonly drawNumber: number }
  | { readonly kind: "within-draws"; readonly drawCount: number };

export type CalculationNode =
  | {
      readonly kind: "constant";
      readonly value: ExactFraction;
      readonly reason: string;
    }
  | {
      readonly kind: "ratio";
      readonly numerator: bigint;
      readonly denominator: bigint;
      readonly value: ExactFraction;
      readonly reason: string;
    }
  | {
      readonly kind: "hypergeometric-no-hit";
      readonly poolSize: number;
      readonly matchingCandidates: number;
      readonly queriedLocations: number;
      readonly value: ExactFraction;
    }
  | {
      readonly kind: "product";
      readonly terms: readonly CalculationNode[];
      readonly value: ExactFraction;
    }
  | {
      readonly kind: "complement";
      readonly term: CalculationNode;
      readonly value: ExactFraction;
    }
  | {
      readonly kind: "weighted-sum";
      readonly terms: readonly {
        readonly weight: ExactFraction;
        readonly conditional: ExactFraction;
      }[];
      readonly value: ExactFraction;
    };

export interface HypothesisExplanation {
  readonly weight: ExactFraction;
  readonly conditionalProbability: ExactFraction;
  readonly formula: CalculationNode;
}

export type InstanceDispositionReason =
  | "candidate"
  | "deterministic-hit"
  | "drawn"
  | "outside-query"
  | "no-queried-pool-location";

export interface InstanceDisposition {
  readonly instanceId: string;
  readonly reason: InstanceDispositionReason;
}

export interface ProbabilityExplanation {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly query: ProbabilityQuery;
  readonly target: CardTarget;
  readonly result: ExactFraction;
  readonly formula: CalculationNode;
  readonly hypotheses: readonly HypothesisExplanation[];
  readonly matchingInstances: readonly InstanceDisposition[];
}

export interface ProbabilityResult {
  readonly exact: ExactFraction;
  readonly decimal: number;
  readonly percentage: number;
  readonly explanation: ProbabilityExplanation;
}

export interface ObserverEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly revision: number;
  readonly kind: string;
  readonly details: JsonObject;
}

export interface AuditEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly revision: number;
  readonly kind: string;
  readonly request: JsonObject;
  readonly resolution: JsonObject;
  readonly observation: ObserverEvent;
}

export interface OperationResult<TCard, TOutput> {
  readonly deck: Deck<TCard>;
  readonly output: TOutput;
  readonly event: AuditEvent;
}

export interface CreateDeckOptions<TCard> {
  readonly cards: readonly TCard[];
  readonly instanceIds?: readonly string[];
  readonly config: DeckConfig<TCard>;
  readonly random?: RandomSource;
  readonly maxHypotheses?: number;
}

export interface ShuffleOptions {
  readonly region?: IndexRange;
  readonly visibility?: Visibility;
  readonly bounds?: BoundsBehavior;
}

export interface ShuffleOutput {
  readonly requestedRegion: IndexRange | null;
  readonly region: IndexRange;
  readonly referenceLength: number;
  readonly wasClamped: boolean;
}

export type InsertItem<TCard> =
  | {
      readonly kind: "new";
      readonly card: TCard;
      readonly instanceId?: string;
    }
  | { readonly kind: "drawn"; readonly instanceId: string };

export interface InsertOptions<TCard> {
  readonly items: readonly InsertItem<TCard>[];
  readonly placement: Placement;
  readonly order?: OrderMode;
  readonly visibility?: Visibility;
  readonly bounds?: BoundsBehavior;
}

export interface InsertOutput<TCard> {
  readonly instances: readonly CardInstance<TCard>[];
  readonly requestedPlacement: Placement;
  readonly appliedGap: number;
  readonly referenceLength: number;
  readonly wasClamped: boolean;
}

export type MoveSelection =
  | { readonly kind: "indices"; readonly indices: readonly number[] }
  | { readonly kind: "instances"; readonly instanceIds: readonly string[] };

export interface MoveOptions {
  readonly selection: MoveSelection;
  readonly placement: Placement;
  readonly order?: OrderMode;
  readonly visibility?: Visibility;
  readonly bounds?: BoundsBehavior;
}

export interface MoveOutput {
  readonly instanceIds: readonly string[];
  readonly requestedPlacement: Placement;
  readonly appliedGap: number;
  readonly referenceLength: number;
  readonly wasClamped: boolean;
}

export interface DrawOptions {
  readonly count?: number;
  readonly reveal?: boolean;
}

export interface DrawOutput<TCard> {
  readonly instances: readonly CardInstance<TCard>[];
  readonly revealed: boolean;
}

export interface Location {
  readonly zone: "active" | "drawn";
  readonly index: number;
}

export type ObservationEvidence =
  | { readonly kind: "instance"; readonly instanceId: string }
  | {
      readonly kind: "target";
      readonly target: CardTarget;
      readonly matches: boolean;
    };

export interface Observation {
  readonly location: Location;
  readonly evidence: ObservationEvidence;
}

export interface ObservationOutput {
  readonly location: Location;
  readonly evidence: ObservationEvidence;
}

export interface CardCodec<TCard> {
  encode(card: TCard): JsonValue;
  decode(value: JsonValue): TCard;
}

export interface RestoreOptions<TCard> {
  readonly config: DeckConfig<TCard>;
  readonly codec: CardCodec<TCard>;
  readonly random?: RandomSource;
}

export interface ReplayOptions<TCard> extends RestoreOptions<TCard> {
  readonly throughSequence?: number;
}
