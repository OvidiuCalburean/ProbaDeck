import {
  createDeck,
  createSeededRandom,
  probabilityWithinDraws,
  shuffleDeck,
  type CardTarget,
  type DeckConfig,
} from "../dist/index.js";

interface ConsumerCard {
  readonly name: string;
  readonly suit: string;
}

const config: DeckConfig<ConsumerCard> = {
  cardKey: (card) => card.name,
  classifiers: { suit: (card) => card.suit },
};
const deck = createDeck({
  cards: [
    { name: "ace", suit: "spades" },
    { name: "king", suit: "hearts" },
  ],
  config,
  random: createSeededRandom({ seed: 42n }),
});
const target: CardTarget = { kind: "classifier", classifier: "suit", value: "spades" };
const result = probabilityWithinDraws(shuffleDeck(deck).deck, target, 1);

result.exact.numerator satisfies bigint;
result.explanation.matchingInstances satisfies readonly unknown[];
