import type {
  AuditEvent,
  CardInstance,
  CardTarget,
  Deck,
  ExactFraction,
  ProbabilityExplanation,
  ProbabilityQuery,
} from "probadeck";

export type ScenarioId = "holdem" | "magic" | "yugioh";

export interface DemoCard {
  readonly id: string;
  readonly name: string;
  readonly game: ScenarioId;
  readonly category: string;
  readonly typeLine: string;
  readonly imagePath: string;
  readonly sourceUrl: string;
  readonly rank?: string;
  readonly suit?: string;
  readonly color?: string;
}

export interface TournamentMeta {
  readonly archetype: string;
  readonly event: string;
  readonly eventDate: string;
  readonly pilot: string;
  readonly sourceUrl: string;
}

export interface CardCatalogEntry extends DemoCard {
  readonly count: number;
}

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  readonly label: string;
  readonly shortLabel: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly deckLabel: string;
  readonly handLabel: string;
  readonly catalog: readonly CardCatalogEntry[];
  readonly tournament?: TournamentMeta;
}

export interface ScenarioZones {
  readonly hand: readonly CardInstance<DemoCard>[];
  readonly community: readonly CardInstance<DemoCard>[];
}

export interface ScenarioEvent {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly revision: number;
  readonly audit?: AuditEvent;
}

export interface ScenarioSession {
  readonly id: ScenarioId;
  readonly definition: ScenarioDefinition;
  readonly deck: Deck<DemoCard>;
  readonly zones: ScenarioZones;
  readonly events: readonly ScenarioEvent[];
  readonly seed: bigint;
}

export type ReturnPlacement =
  | { readonly kind: "top" }
  | { readonly kind: "position"; readonly position: number }
  | { readonly kind: "bottom" };

export type ScenarioAction =
  | { readonly kind: "draw" }
  | {
      readonly kind: "return-card";
      readonly instanceId: string;
      readonly placement: ReturnPlacement;
    }
  | { readonly kind: "shuffle" };

export interface ProbabilityRow {
  readonly target: CardTarget;
  readonly card: CardCatalogEntry;
  readonly exact: ExactFraction;
  readonly exactLabel: string;
  readonly percentage: number;
  readonly totalCopies: number;
  readonly remainingCopies: number;
  readonly explanation: ProbabilityExplanation;
}

export interface ClassifierProbability {
  readonly label: string;
  readonly exact: ExactFraction;
  readonly exactLabel: string;
  readonly percentage: number;
  readonly explanation: ProbabilityExplanation;
}

export interface ProbabilityView {
  readonly query: ProbabilityQuery;
  readonly rows: readonly ProbabilityRow[];
  readonly classifier: ClassifierProbability | null;
}
