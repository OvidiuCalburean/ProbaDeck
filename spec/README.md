# ProbaDeck specification

The normative language-independent contract is defined in [`v1.md`](./v1.md). JSON Schemas in
[`schema`](./schema) define the portable conformance, event-log, and snapshot envelopes.

The TypeScript implementation may expose idiomatic TypeScript types, but observable behavior must
remain compatible with this specification and the fixtures under `conformance/scenarios`.
