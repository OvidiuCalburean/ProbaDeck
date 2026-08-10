# Conformance fixtures

Fixtures in `scenarios` verify that every ProbaDeck implementation follows the shared
language-independent specification.

Each fixture:

- declares the normative requirement IDs it covers;
- uses explicit physical instance IDs;
- derives card keys and classifiers through JSON Pointers;
- records seeds and entropy as decimal strings or unsigned 32-bit integers; and
- expresses exact fractions with decimal-string numerators and denominators.

Human-readable explanation prose is deliberately not compared across languages. Portable
explanations are validated against the shared structured formula and reason-code schema; scenario
assertions compare exact fractions and operation outcomes.
