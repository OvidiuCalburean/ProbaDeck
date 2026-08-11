# ProbaDeck

ProbaDeck is a deterministic deck simulation and explainable probability engine for partially
known card decks. The TypeScript implementation is an immutable, ESM-only library for Node.js and
evergreen browsers; a language-independent specification and conformance fixtures define behavior
for future Rust, Python, Go, and other implementations.

## What it provides

- Arbitrary caller-defined card data, logical card identity, named classifiers, duplicate logical
  cards, and unique physical instance IDs.
- Immutable shuffle, insert, move, draw, and observe operations with exact, top, bottom, regional,
  and random placement controls.
- An actual simulated order kept separate from one observer's exact knowledge.
- Exact fractions, decimal and percentage views, and structured calculation explanations.
- Portable `pcg32-v1` seeded randomness, injectable custom sources, privileged audit events,
  redacted observer events, snapshots, and replay that does not rerun randomness.
- Explicit failure when an operation cannot remain exact or would exceed the configured hypothesis
  limit; ProbaDeck never silently approximates.

## License, installation, and runtime support

ProbaDeck is open-source software available under the [MIT License](LICENSE). Anyone may use,
modify, distribute, sublicense, or sell software built with it under the license terms.

The package is named `probadeck` and is release-ready, but it has not been published to npm yet.
Until the first public release, build and verify the same installable tarball from a clone:

```sh
pnpm install
pnpm pack:package
```

This creates `artifacts/probadeck-1.0.0.tgz`. Install that tarball from another project with
`pnpm add /path/to/ProbaDeck/artifacts/probadeck-1.0.0.tgz`. `pnpm test:package` independently packs
the library into a temporary directory, installs it in a clean consumer, and runs a smoke test.
Once the package is published, installation will be `pnpm add probadeck`.

The v1 package targets ES2022 ESM, Node.js 22.12 or newer, evergreen browsers, and TypeScript 5.0 or
newer. CommonJS is not supported.

## Quick start

```ts
import {
  createDeck,
  createSeededRandom,
  probabilityAtDraw,
  probabilityOfNext,
  probabilityWithinDraws,
  shuffleDeck,
} from "probadeck";

const cards = Array.from({ length: 10 }, (_, index) => ({
  name: index === 0 ? "target" : `other-${index}`,
  rarity: index === 0 ? "rare" : "common",
}));
const config = {
  cardKey: (card: (typeof cards)[number]) => card.name,
  classifiers: { rarity: (card: (typeof cards)[number]) => card.rarity },
};

const initial = createDeck({
  cards,
  config,
  random: createSeededRandom({ seed: 42n }),
});
const shuffled = shuffleDeck(initial).deck;
const target = { kind: "card-key", cardKey: "target" } as const;

probabilityOfNext(shuffled, target).exact; // { numerator: 1n, denominator: 10n }
probabilityAtDraw(shuffled, target, 7).exact; // 1/10: draw numbers are 1-based
probabilityWithinDraws(shuffled, target, 3).exact; // 3/10: at least one hit in the prefix
```

These queries are deliberately distinct:

- `probabilityOfNext` asks about active position zero now.
- `probabilityAtDraw(deck, target, N)` asks about exactly the 1-based draw `N` in the current
  snapshot; it does not assume earlier misses.
- `probabilityWithinDraws(deck, target, N)` asks whether at least one matching card occurs in the
  first `N` cards of the current snapshot.

Revealed draws condition the new immutable snapshot. For example, after two observed misses from a
ten-card shuffled deck containing one target, the probability of the next card is `1/8`; the old
snapshot still answers `1/10`.

## Interactive showcase

The statically generated Astro/React showcase applies the same ProbaDeck API to three recognizable
games:

- Texas Hold'em deals a two-card hand and up to five community cards and lists the exact next-card
  probability for every remaining card. Reset advances the seed, reshuffles the full deck, and
  redeals the five opening cards.
- Magic: The Gathering uses Nathan Steuer's 60-card Selesnya Landfall main deck from his 2026 Pro
  Tour Secrets of Strixhaven win. It tracks the named `type: Land` classifier alongside copy-aware
  card probabilities.
- Yu-Gi-Oh! uses Ryan Yu's 40-card Sky Striker main deck from his 2026 North America WCQ win and
  demonstrates the same draw, return-to-position, shuffle, and probability operations.

Run the local showcase with:

```sh
pnpm dev:showcase
```

Card metadata and artwork are cached in the repository so the demo works without runtime API
calls. Refresh those assets explicitly with `pnpm sync:showcase-assets`. The showcase is a
non-commercial documentation example and includes source attribution and trademark/copyright
disclaimers in the page footer.

The production hosting definition lives in `infra/aws`. It uses a private S3 origin, CloudFront,
AWS WAF, Route 53, and a DNS-validated ACM certificate. Production publishing is blocked unless
the pipeline verifies that the distribution, WAF web ACL, and hosted zone are on an active
CloudFront FREE flat-rate plan. See [the deployment runbook](infra/aws/README.md) before changing
any AWS resource.

## Operations and knowledge visibility

Every operation returns `{ deck, output, event }`. The returned deck has one higher revision; the
input deck remains unchanged. Card indices, placement offsets, and insertion gaps are zero-based.
`from-bottom: 0` is the end gap. Bounds default to `error`; opt-in `clamp` output reports the
requested placement or range, applied position, reference length, and whether clamping occurred.

Random shuffle, insertion, and ordering outcomes are hidden from observer knowledge by default but
remain available in the privileged audit log for deterministic replay. Draws reveal their physical
instance IDs by default. A `visibility: "revealed"` operation explicitly conditions knowledge on
the resolved random result. Reading the audit log does not itself reveal anything to the modeled
observer.

Targets can select an instance ID, a logical card key, classifier equality, or nested `all`, `any`,
and `not` expressions. Explanations identify the query and target, exact formula tree, weighted
hypotheses, and why matching physical copies are eligible, already drawn, or outside the query.

## Persistence and replay

Card callbacks cannot be serialized. Supply the same configuration plus a codec for card data when
restoring a snapshot or replaying an event log:

```ts
import { restoreSnapshot, serializeSnapshot } from "probadeck";

const codec = {
  encode: (card: { name: string; rarity: string }) => card,
  decode: (value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("name" in value) ||
      !("rarity" in value) ||
      typeof value.name !== "string" ||
      typeof value.rarity !== "string"
    ) {
      throw new TypeError("Invalid card data");
    }
    return { name: value.name, rarity: value.rarity };
  },
};

const snapshot = serializeSnapshot(shuffled, codec);
const restored = restoreSnapshot(snapshot, { config, codec });
```

The codec must return JSON-compatible values. Restoration recomputes logical keys and classifiers
and rejects metadata drift. Built-in PCG state resumes exactly; a log created with a custom
non-serializable source needs a replacement source before subsequent random operations.

## Repository and development

- `packages/typescript` — the release-ready TypeScript package named `probadeck`
- `examples/showcase` — the statically generated Astro/React website using the workspace package
- `infra/aws` — cost-guarded AWS infrastructure and deployment preflight checks
- `spec` — the normative language-independent v1 contract and JSON Schemas
- `conformance` — portable cross-language scenarios and expected exact results

This repository uses pnpm and Oxlint/Oxfmt:

```sh
pnpm install
pnpm check
```

Useful commands:

- `pnpm check:core` — formatting, lint, typecheck, 100% coverage, build, and TypeScript 5.0 consumer
- `pnpm check:showcase` — typecheck, unit tests, static production build, and hosting tests
- `pnpm check:infra` — test and synthesize the AWS infrastructure without contacting AWS
- `pnpm test:browser` — run the ESM simulation smoke test in real Chromium
- `pnpm test:lighthouse` — build the static site and enforce median Lighthouse budgets on every public page
- `pnpm test:package` — pack the tarball, install it into a clean consumer, and execute it
- `pnpm test:property` — run exhaustive and property-based verification
- `pnpm test:stress` — run 500 generated, deterministic mixed-operation histories (up to 80
  commands each) with snapshot/replay checks
- `pnpm lint` / `pnpm format` — run Oxlint or apply Oxfmt

Stress failures include a fast-check seed and shrink path. Reproduce one exactly with
`PROBADECK_STRESS_SEED=<seed> PROBADECK_STRESS_PATH=<path> pnpm test:stress`; tune volume with
`PROBADECK_STRESS_RUNS` and `PROBADECK_STRESS_COMMANDS`. Scheduled CI raises both the property and
state-machine budgets beyond the pull-request suite.

See the [conformance guide](conformance/README.md) for the portable scenario format and expected
results. The repository is MIT licensed; the first npm publication remains an explicit release
action.
