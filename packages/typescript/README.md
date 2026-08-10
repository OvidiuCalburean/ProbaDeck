# probadeck

Deterministic deck simulation and explainable exact probabilities for partially known card decks.

ProbaDeck is available under the MIT License. The package is release-ready but has not been
published to npm yet. From a repository clone, `pnpm pack:package` creates
`artifacts/probadeck-1.0.0.tgz`; install that tarball from your project with
`pnpm add /path/to/ProbaDeck/artifacts/probadeck-1.0.0.tgz`. Once published, installation will be
`pnpm add probadeck`.

```ts
import { createDeck, createSeededRandom, probabilityWithinDraws, shuffleDeck } from "probadeck";

const deck = createDeck({
  cards: [{ name: "target" }, { name: "other" }],
  config: { cardKey: (card) => card.name },
  random: createSeededRandom({ seed: 42n }),
});
const shuffled = shuffleDeck(deck).deck;
const result = probabilityWithinDraws(shuffled, { kind: "card-key", cardKey: "target" }, 1);

result.exact; // { numerator: 1n, denominator: 2n }
result.explanation; // versioned structured calculation data
```

V1 is ESM-only and supports Node.js 22.12+, evergreen browsers, and TypeScript 5.0+. It provides
immutable shuffle/insert/move/draw/observe operations, exact physical and logical card targets,
portable seeded randomness, observer-aware audit data, snapshots, and deterministic event replay.

See the repository README and language-independent v1 specification for the complete API semantics.
