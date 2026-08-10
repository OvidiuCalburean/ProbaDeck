# ProbaDeck TypeScript v1 Implementation Plan

## Summary

Implement a public, immutable ESM library for Node.js and browsers. It will maintain a privileged concrete deck alongside one observer’s exact knowledge, support every agreed manipulation, return exact explainable probabilities, and provide portable seeded randomness, audit replay, and snapshots.

No probability may be approximated. Hidden operations that would exceed the default 10,000-hypothesis limit fail atomically before RNG consumption.

## Public contract and semantics

- Export an opaque `Deck<TCard>` and free functions: `createDeck`, `shuffleDeck`, `insertCards`, `moveCards`, `drawCards`, `observe`, the three probability queries, inspection functions, and persistence/replay functions.
- `DeckConfig<TCard>` supplies a string `cardKey` and named classifiers returning one or more strings. Cache normalized classifier results when cards enter the registry.
- Wrap cards as immutable `CardInstance<TCard>` values with deterministic `instance-1`, `instance-2`, … defaults and optional caller-supplied unique string IDs. Duplicate logical keys remain valid; duplicate physical IDs fail.
- Return immutable operation results shaped as `{ deck, output, event }`; previous deck snapshots remain usable. Do not add a mutable wrapper in v1.
- Support structured targets for physical instance, logical key, classifier equality, and nested `all`, `any`, and `not`. Reject empty composites and arbitrary callback predicates.
- Expose:
  - `probabilityOfNext(deck, target)`
  - `probabilityAtDraw(deck, target, drawNumber)` using a 1-based draw number relative to the current snapshot
  - `probabilityWithinDraws(deck, target, count)`, allowing `0..deck.length`
- Return reduced `bigint` numerator/denominator values plus approximate decimal, percentage, and a versioned structured explanation.
- Use 0-based card indices, offsets, and insertion gaps. `fromBottom: 0` means the end gap. Random placement regions use inclusive gap bounds; shuffle regions use half-open card-index ranges.
- Bounds default to `"error"`; `"clamp"` is opt-in. Successful clamped operations report the request, reference length, applied position, and `wasClamped`.
- Insert/move batches remain contiguous. Inserted cards preserve input order; moved cards preserve their current top-to-bottom order. `"random"` uniformly randomizes internal order.
- Resolve move selections against the pre-operation deck, remove them simultaneously, then resolve the destination against the remaining length.
- Hidden RNG outcomes are the default for shuffles, randomized order, and random placement. Drawn identities are revealed by default. All operations allow an explicit visibility override.
- Accept observations of an exact instance or a structured selector hit/miss at an active or drawn location.

## Architecture and implementation phases

1. **Specification and conformance contract**
   - Write normative requirement IDs covering identity, indexing, visibility, bounds, probabilities, errors, randomness, persistence, and replay.
   - Define versioned JSON Schemas for scenarios, events, snapshots, exact fractions, and explanation reason/formula nodes.
   - Represent fixture classifiers with JSON Pointer extraction, explicit instance IDs, decimal-string fractions, and entropy tapes so fixtures remain language-independent.

2. **Deterministic foundations**
   - Implement configuration validation, instance registry and active/drawn zones, exact rational arithmetic, combinatorics, structured errors, position resolution, revisions, and event envelopes.
   - Start knowledge as one weighted hypothesis with every initial position fixed.
   - Implement deterministic insert, move, draw, and fully known probability queries before introducing randomness.
   - Every successful operation increments the revision and appends exactly one event; failures leave all prior state untouched.

3. **Knowledge and exact inference**
   - Represent knowledge as normalized weighted hypotheses. Within each hypothesis, every active or drawn slot is either fixed or belongs to a uniform pool with an equal-sized candidate set and uniform bijection.
   - Allow pools to span active and drawn zones, preserving dependencies after hidden draws.
   - Transform every possible observer-visible world for hidden operations; condition and renormalize for revealed outcomes or selector evidence.
   - Canonicalize pool identities, merge equivalent hypotheses, remove zero weights, and require total weight `1`.
   - Enforce a configurable `maxHypotheses`, defaulting to `10_000`. Preflight prospective transitions and throw `INFERENCE_LIMIT_EXCEEDED` with projected and allowed counts plus remediation guidance.
   - Calculate exact-position probability as fixed `0/1` or pool ratio `matches/poolSize`. Calculate cumulative probability per hypothesis with hypergeometric no-hit factors, then combine hypotheses by exact weighted sum.
   - Group equivalent explanation terms and account for every matching copy as eligible, fixed outside scope, drawn/removed, or uncertain within a pool.

4. **Random operations and manipulation completeness**
   - Specify `pcg32-v1` as the portable built-in RNG, accepting an unsigned 64-bit `bigint` or decimal string seed and an optional stream defaulting to `1`.
   - Provide an immutable `RandomSource` interface for injection; never fall back to `Math.random`.
   - Use rejection sampling for unbiased bounded integers and Fisher–Yates for shuffle/random batch order. Lock golden vectors in conformance fixtures.
   - Support whole/region shuffle, exact/top/bottom/random-within placement, new cards, reinsertion of drawn instances, movement by indices or IDs, hidden/revealed draws, and selector observations.
   - Keep full random resolutions in privileged audit events while exposing a redacted observer event projection. Reading the audit log does not implicitly change modeled knowledge.

5. **Persistence, replay, and release hardening**
   - Add versioned full snapshots and creation-to-current audit streams. Arbitrary card data requires JSON compatibility or a caller-provided `CardCodec<TCard>`.
   - Do not serialize callbacks; restoration receives `DeckConfig` again, recomputes cached metadata, and rejects mismatches.
   - Replay recorded resolutions without invoking RNG. Restore built-in RNG continuation state; require a replacement source before continuing a replay made with a non-serializable custom RNG.
   - Validate schema versions, event ordering, revisions, requested/resolved positions, entropy records, visibility, and derived metadata. Detect divergence but make no cryptographic authenticity claim.
   - Document the public API with runnable examples and promote the package to `1.0.0` only after all conformance and package gates pass.

## Test and acceptance plan

- Preserve the existing per-file 100% statement, branch, function, and line coverage gates.
- Cover exact fractions, classifier normalization, duplicate logical cards, ID collisions, all bounds, empty decks, impossible observations, every error code, immutable snapshots, and audit/observer separation.
- Lock the ten-card examples:
  - one target after shuffle: exact draw `N = 1/10`
  - within `N = N/10`
  - after `N-1` revealed misses: next `= 1/(11-N)`
  - three duplicate targets: exact `3/10`, within two `8/15`
  - one physical instance within two `1/5`
- Test fixed eligible/ineligible copies, multiple pools, hidden draws, selector hit/miss conditioning, hidden regional insertion, random batch order, regional shuffle, and hypothesis-limit atomicity.
- Use `fast-check` for instance conservation, unique IDs, zone partitioning, normalized weights/fractions, probability bounds, cumulative monotonicity, seed determinism, immutability, and replay equivalence.
- Build an independent exhaustive possible-world oracle for decks of at most seven instances and compare generated command sequences, probabilities, observations, events, and failures.
- Verify PCG32 golden vectors and scripted rejection-sampling paths rather than statistical uniformity tests.
- Test log/snapshot round trips, replay prefixes, corrupted or reordered events, unknown versions, metadata mismatches, and proof that replay never calls RNG.
- Expand CI to Node 22.12 and 24, a headless browser ESM smoke test, conformance-schema validation, packed-tarball consumer tests, and higher-run nightly property tests.

## Assumptions and exclusions

- The core targets ES2022 ESM for Node and evergreen browsers; CommonJS is deferred.
- Card values and configuration callbacks are treated as immutable and pure after ingestion.
- V1 models one observer; audit access is privileged inspection rather than a security boundary.
- Arbitrary relational constraints, multi-observer knowledge, approximate inference, dispersed batch placement, and a mutable convenience API are deferred.
- Publishing to npm and choosing a repository license are outside implementation scope; the package will be release-ready but not published automatically.
