import standardPayload from "../data/standard.json";
import type { CardCatalogEntry, ScenarioDefinition } from "./types.js";

interface StandardPayload {
  readonly cards: readonly {
    readonly id: string;
    readonly name: string;
    readonly count: number;
    readonly typeLine: string;
    readonly rank: string;
    readonly suit: string;
    readonly color: string;
    readonly imagePath: string;
    readonly sourceUrl: string;
  }[];
}

const catalog: readonly CardCatalogEntry[] = (standardPayload as StandardPayload).cards.map(
  (card): CardCatalogEntry =>
    Object.assign({}, card, {
      game: "holdem" as const,
      category: card.suit,
    }),
);

export const holdemDefinition: ScenarioDefinition = {
  id: "holdem",
  label: "Texas Hold'em",
  shortLabel: "Texas Hold'em",
  eyebrow: "52-card table",
  title: "The river changes what the deck knows.",
  description:
    "Reveal hole cards and the board, redeal from a fresh deterministic shuffle, then inspect every exact next-card probability.",
  deckLabel: "Remaining deck",
  handLabel: "Your hand",
  catalog,
};
