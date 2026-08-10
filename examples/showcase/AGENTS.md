# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable showcase decisions

- Treat the selected Texas Hold'em Option 1 mock as the visual source of truth for all three tabs.
- The Magic scenario uses Nathan Steuer's 60-card Selesnya Landfall main deck from his win at Pro Tour Secrets of Strixhaven, May 2026.
- The Yu-Gi-Oh! scenario uses Ryan Yu's 40-card Sky Striker main deck from his win at the North America WCQ, July 2026.
- The showcase is a non-commercial documentation example and must retain data-source, copyright, and trademark disclaimers.
- Scryfall, YGOPRODeck, and Deck of Cards provide metadata and artwork only. ProbaDeck owns every shuffle, draw, move, observation, and probability result.
- Tournament hands must preserve readable card widths and use horizontal scrolling as the hand grows; captions must never overlap adjacent cards.
- Return-position controls stay compact at tablet widths and become a clearly labeled, full-width control group only on narrow mobile screens.
- Texas Hold'em does not expose a move-top-to-bottom control because hidden permutations leave its displayed probability unchanged.
- Reset advances the active scenario's deterministic seed, reshuffles the full deck, and redeals every opening card rather than replaying the same seed.
- The `type: Land` TypeScript explanation strip and its header link are Magic-only and must not render on Texas Hold'em or Yu-Gi-Oh! tabs.
- Dark action buttons must retain a dark background and readable white label in hover and focus states.
- The showcase's numbered return control is 1-based from the top: position 1 is the top card, position 2 is second, and UI/event copy must not expose the core's zero-based gap terminology.
- The homepage closes with a community callout inviting feature requests through GitHub issues and contributions through pull requests.
- The app favicon reuses the header's thin cube mark on the dark ProbaDeck brand background.
