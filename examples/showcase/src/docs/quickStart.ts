export const quickStartBody = `const cards = Array.from({ length: 10 }, (_, index) => ({
  name: index === 0 ? "target" : \`other-\${index}\`,
  rarity: index === 0 ? "rare" : "common",
}));

const config = {
  cardKey: (card) => card.name,
  classifiers: { rarity: (card) => card.rarity },
};

const initial = createDeck({
  cards,
  config,
  random: createSeededRandom({ seed: 42n }),
});
const shuffled = shuffleDeck(initial).deck;
const result = probabilityWithinDraws(
  shuffled,
  { kind: "classifier", classifier: "rarity", value: "rare" },
  3,
);

result.exact;       // { numerator: 3n, denominator: 10n }
result.explanation; // structured proof`;

export const quickStartCode = `import {
  createDeck,
  createSeededRandom,
  probabilityWithinDraws,
  shuffleDeck,
} from "probadeck";

${quickStartBody}`;
