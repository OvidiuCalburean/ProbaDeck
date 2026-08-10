import yugiohPayload from "../data/yugioh.json";
import type { CardCatalogEntry, ScenarioDefinition, TournamentMeta } from "./types.js";

interface YugiohPayload {
  readonly tournament: TournamentMeta;
  readonly cards: readonly {
    readonly id: string;
    readonly name: string;
    readonly count: number;
    readonly typeLine: string;
    readonly imagePath: string;
    readonly sourceUrl: string;
  }[];
}

const payload = yugiohPayload as YugiohPayload;
const catalog: readonly CardCatalogEntry[] = payload.cards.map((card) => ({
  ...card,
  game: "yugioh",
  category: card.typeLine.includes("Monster") ? "Monster" : "Spell",
}));

export const yugiohDefinition: ScenarioDefinition = {
  id: "yugioh",
  label: "Yu-Gi-Oh!",
  shortLabel: "Yu-Gi-Oh!",
  eyebrow: "40-card tournament deck",
  title: "Every known card reshapes the next draw.",
  description:
    "Explore Ryan Yu's undefeated North America WCQ-winning Sky Striker list with exact copy-aware probabilities.",
  deckLabel: "Main deck",
  handLabel: "Opening hand",
  catalog,
  tournament: payload.tournament,
};
