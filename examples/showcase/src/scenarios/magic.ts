import magicPayload from "../data/magic.json";
import type { CardCatalogEntry, ScenarioDefinition, TournamentMeta } from "./types.js";

interface MagicPayload {
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

const payload = magicPayload as MagicPayload;
const catalog: readonly CardCatalogEntry[] = payload.cards.map((card) => ({
  ...card,
  game: "magic",
  category: card.typeLine.includes("Land") ? "Land" : "Nonland",
}));

export const magicDefinition: ScenarioDefinition = {
  id: "magic",
  label: "Magic: The Gathering",
  shortLabel: "Magic",
  eyebrow: "60-card tournament deck",
  title: "A winning list, one exact draw at a time.",
  description:
    "Draw from Nathan Steuer's Pro Tour-winning Selesnya Landfall list and track the land ratio as the hand changes.",
  deckLabel: "Library",
  handLabel: "Opening hand",
  catalog,
  tournament: payload.tournament,
};
