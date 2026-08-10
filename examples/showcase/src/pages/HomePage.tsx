import { ArrowRight, CardsThree, Eye, Globe, MagicWand } from "@phosphor-icons/react";

import { AppHeader } from "../components/AppHeader.js";
import { SiteFooter } from "../components/SiteFooter.js";

const examples = [
  {
    description: "Hole cards, community cards, and every exact next-card probability.",
    href: "/examples#holdem",
    icon: CardsThree,
    link: "Open Texas Hold’em",
    title: "Texas Hold’em",
  },
  {
    description: "A tournament deck with copy-aware odds and a named Land classifier.",
    href: "/examples#magic",
    icon: MagicWand,
    link: "Open Magic",
    title: "Magic: The Gathering",
  },
  {
    description: "Opening hands, returns, hidden shuffles, and the same exact engine.",
    href: "/examples#yugioh",
    icon: Eye,
    link: "Open Yu-Gi-Oh!",
    title: "Yu-Gi-Oh!",
  },
] as const;

const capabilities = [
  {
    copy: "Shuffle, insert, move, draw, and observe return a new deck state. Earlier states remain valid.",
    title: "Immutable deck operations",
  },
  {
    copy: "Every result includes an exact rational value and a structured, machine-readable explanation.",
    title: "Exact fractions and explanations",
  },
  {
    copy: "Portable PCG32 randomness and event logs make every outcome reproducible and auditable.",
    title: "Seeded replay and audit",
  },
  {
    copy: "Expensive or inexact operations fail clearly. The engine never quietly swaps in an approximation.",
    title: "Explicit complexity limits",
  },
] as const;

function ProbabilityPreview() {
  return (
    <div className="hero-preview" aria-label="Preview of the Texas Hold’em probability example">
      <div className="preview-toolbar">
        <span className="preview-game">
          <CardsThree aria-hidden="true" size={20} weight="thin" />
          Texas Hold’em
        </span>
        <span>next card</span>
      </div>
      <div className="preview-copy">
        <strong>Flop dealt</strong>
        <span>Every value updates from the same immutable snapshot.</span>
      </div>
      <div className="preview-table">
        <div>
          <small>Your hand</small>
          <div className="preview-cards">
            <img src="/assets/cards/standard/9S.png" alt="Nine of spades" />
            <img src="/assets/cards/standard/8H.png" alt="Eight of hearts" />
          </div>
        </div>
        <div>
          <small>Community board</small>
          <div className="preview-cards">
            <img src="/assets/cards/standard/9H.png" alt="Nine of hearts" />
            <img src="/assets/cards/standard/7D.png" alt="Seven of diamonds" />
            <img src="/assets/cards/standard/2S.png" alt="Two of spades" />
          </div>
        </div>
      </div>
      <div className="preview-deck-line">
        <span>Remaining deck</span>
        <strong>47 cards</strong>
      </div>
      <div className="preview-result-grid">
        <div>
          <span>Any heart</span>
          <strong>10 / 47</strong>
          <small>21.276…%</small>
        </div>
        <pre>
          <code>{`P(next ∈ ♥ | knowledge) = 10/47
// exact fraction, no approximation`}</code>
        </pre>
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="app-shell" id="top">
      <AppHeader current="home" />
      <main className="marketing-main">
        <section className="home-hero">
          <div className="site-container home-hero-layout">
            <div className="home-hero-copy">
              <h1>Exact probabilities for decks you only partly know.</h1>
              <p>
                Model hidden order, observer knowledge, seeded randomness, and every draw—without
                silent approximation.
              </p>
              <div className="hero-actions">
                <a className="button button--primary button--large" href="/examples">
                  Explore the examples <ArrowRight aria-hidden="true" />
                </a>
                <a className="text-link" href="/docs">
                  Read the docs <ArrowRight aria-hidden="true" />
                </a>
              </div>
            </div>
            <ProbabilityPreview />
          </div>
        </section>

        <section className="home-examples section-rule" aria-labelledby="examples-title">
          <div className="site-container">
            <div className="section-heading section-heading--centered">
              <span className="section-kicker">Examples, not limits</span>
              <h2 id="examples-title">Three examples. Any deck-driven system.</h2>
              <p>
                These are familiar reference implementations—not built-in game modes. You define the
                cards, identities, classifiers, and operations; ProbaDeck provides the same
                deterministic state and exact knowledge model underneath.
              </p>
            </div>
            <div className="example-rail">
              {examples.map(({ description, href, icon: Icon, link, title }) => (
                <article key={title} className="example-entry">
                  <Icon aria-hidden="true" size={40} weight="thin" />
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <a className="text-link" href={href}>
                      {link} <ArrowRight aria-hidden="true" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
            <div className="example-scope" aria-label="Other kinds of decks ProbaDeck can model">
              <strong>Bring your own deck</strong>
              <ul>
                <li>Classic &amp; casino</li>
                <li>Trading cards</li>
                <li>Board-game events</li>
                <li>Encounter &amp; loot decks</li>
                <li>Learning systems</li>
                <li>Custom simulations</li>
              </ul>
              <a className="text-link" href="/docs#core-model">
                Define a card model <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="knowledge-section section-rule">
          <div className="site-container knowledge-layout">
            <div className="knowledge-intro">
              <h2>Actual order and observer knowledge stay separate.</h2>
              <p>
                ProbaDeck keeps the full deterministic order for correctness while calculating from
                exactly what a particular observer knows—nothing more.
              </p>
              <a className="button" href="/docs#knowledge">
                Understand knowledge <ArrowRight aria-hidden="true" />
              </a>
            </div>

            <div className="knowledge-order" aria-label="Hidden actual deck order">
              <strong>Actual order</strong>
              <span>privileged and deterministic</span>
              <ol>
                <li>
                  <span>01</span> Nine of spades
                </li>
                <li>
                  <span>02</span> Ace of hearts
                </li>
                <li>
                  <span>03</span> Queen of diamonds
                </li>
                <li>
                  <span>…</span> hidden continuation
                </li>
              </ol>
            </div>

            <div className="knowledge-visible">
              <strong>Observer knowledge</strong>
              <span>visible and queryable</span>
              <ul>
                <li>Knows revealed card identities</li>
                <li>Knows remaining suit and type counts</li>
                <li>Does not know hidden positions</li>
                <li>Receives exact conditioned probabilities</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="capabilities-section section-rule">
          <div className="site-container capabilities-layout">
            <div>
              <h2>Built for deterministic simulations and serious analysis.</h2>
              <div className="capability-list">
                {capabilities.map((capability, index) => (
                  <article key={capability.title}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{capability.title}</h3>
                      <p>{capability.copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="home-code-panel">
              <div className="code-tabs" aria-hidden="true">
                <span className="is-active">TypeScript</span>
                <span>Exact result</span>
              </div>
              <pre aria-label="ProbaDeck TypeScript example">
                <code>{`const deck = createDeck({
  cards,
  config,
  random: createSeededRandom({ seed: 42n }),
});

const shuffled = shuffleDeck(deck).deck;
const result = probabilityWithinDraws(
  shuffled,
  { kind: "classifier", classifier: "suit", value: "heart" },
  3,
);

result.exact;       // { numerator, denominator }
result.explanation; // structured proof`}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="language-callout">
          <div className="site-container language-callout-inner">
            <Globe aria-hidden="true" size={52} weight="thin" />
            <div>
              <h2>TypeScript today. A portable specification for every language.</h2>
              <p>
                Use ProbaDeck now in TypeScript and JavaScript. The normative v1 specification and
                conformance fixtures define the path for Rust, Python, Go, and other
                implementations.
              </p>
            </div>
            <a className="button button--dark" href="/docs#languages">
              See language support <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
