import { ArrowRight, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader.js";
import { SiteFooter } from "../components/SiteFooter.js";
import {
  apiGroups,
  errorCodes,
  type ApiEntry,
  type ApiParameter,
  typeGroups,
} from "../docs/reference.js";

const quickStartCode = `import {
  createDeck,
  createSeededRandom,
  probabilityWithinDraws,
  shuffleDeck,
} from "probadeck";

const initial = createDeck({
  cards,
  config: {
    cardKey: (card) => card.id,
    classifiers: {
      kind: (card) => card.kind,
      tags: (card) => card.tags,
    },
  },
  random: createSeededRandom({ seed: 42n }),
});

const deck = shuffleDeck(initial).deck;
const result = probabilityWithinDraws(
  deck,
  { kind: "classifier", classifier: "kind", value: "resource" },
  3,
);

result.exact;       // reduced bigint fraction
result.explanation; // structured proof`;

const cardModelCode = `type EncounterCard = {
  id: string;
  difficulty: "safe" | "dangerous";
  regions: readonly string[];
};

const config = {
  cardKey: (card: EncounterCard) => card.id,
  classifiers: {
    difficulty: (card: EncounterCard) => card.difficulty,
    region: (card: EncounterCard) => card.regions,
  },
};`;

const navigationGroups = [
  {
    label: "Start",
    links: [
      ["overview", "Overview"],
      ["quick-start", "Quick start"],
      ["core-model", "Core model"],
      ["positions-targets", "Positions & targets"],
    ],
  },
  {
    label: "API reference",
    links: apiGroups.map((group) => [group.id, group.label] as const),
  },
  {
    label: "Reference",
    links: [
      ["types", "Type reference"],
      ["error-codes", "Error codes"],
      ["languages", "Language support"],
    ],
  },
] as const;

const targetVariants = [
  ["instance", "One physical card by instanceId."],
  ["card-key", "Every copy sharing a logical card key."],
  ["classifier", "Cards with a value from a named classifier."],
  ["all", "Intersection of every nested target."],
  ["any", "Union of nested targets without double-counting."],
  ["not", "The complement of one nested target."],
] as const;

const placementVariants = [
  ["index", "An exact insertion gap from 0 through the reference length."],
  ["from-top", "Offset 0 is the top gap; larger offsets move downward."],
  ["from-bottom", "Offset 0 is the final gap; larger offsets move upward."],
  ["random-within", "An inclusive startGap…endGap choice using the deck RandomSource."],
] as const;

const documentationLanguages = [
  { id: "typescript", label: "TypeScript / JavaScript", status: "Available" },
  { id: "rust", label: "Rust", status: "Planned" },
  { id: "python", label: "Python", status: "Planned" },
  { id: "go", label: "Go", status: "Planned" },
] as const;

function CopyCodeButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="copy-button" type="button" onClick={copy} aria-label="Copy code">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function CodeBlock({ code, label }: { readonly code: string; readonly label: string }) {
  return (
    <div className="reference-code" data-code-language="typescript">
      <div className="reference-code__heading">
        <div className="reference-code__meta">
          <span>{label}</span>
          <span className="code-language-badge">TypeScript / JavaScript</span>
        </div>
        <CopyCodeButton text={code} />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ParametersTable({ parameters }: { readonly parameters: readonly ApiParameter[] }) {
  return (
    <div className="parameter-table" role="table" aria-label="Parameters and options">
      <div className="parameter-row parameter-row--header" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Type / default</span>
        <span role="columnheader">Description</span>
      </div>
      {parameters.map((parameter) => (
        <div className="parameter-row" role="row" key={parameter.name}>
          <code role="cell">{parameter.name}</code>
          <span role="cell">
            <code>{parameter.type}</code>
            {parameter.defaultValue === undefined ? null : (
              <small>Default: {parameter.defaultValue}</small>
            )}
          </span>
          <p role="cell">{parameter.description}</p>
        </div>
      ))}
    </div>
  );
}

function ApiReferenceEntry({ entry }: { readonly entry: ApiEntry }) {
  return (
    <article
      className="api-entry"
      id={entry.id}
      data-api-symbol={entry.name}
      aria-labelledby={`${entry.id}-title`}
    >
      <div className="api-entry__heading">
        <div>
          <span>{entry.kind}</span>
          <h3 id={`${entry.id}-title`}>{entry.name}</h3>
        </div>
        <a href={`#${entry.id}`} aria-label={`Link to ${entry.name}`}>
          #
        </a>
      </div>
      <p className="api-entry__summary">{entry.summary}</p>
      <pre className="signature-block">
        <code>{entry.signature}</code>
      </pre>
      <h4>Parameters &amp; options</h4>
      <ParametersTable parameters={entry.parameters} />
      <div className="return-note">
        <strong>Returns</strong>
        <p>{entry.returns}</p>
      </div>
      {entry.example === undefined ? null : (
        <CodeBlock code={entry.example} label="Usage example" />
      )}
      {entry.notes === undefined ? null : (
        <div className="api-notes">
          <WarningCircle aria-hidden="true" />
          <div>
            {entry.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export function DocsPage() {
  useEffect(() => {
    let frame = 0;

    function scrollToHash() {
      window.cancelAnimationFrame(frame);
      const id = window.location.hash.slice(1);
      if (id === "") return;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
      });
    }

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    window.addEventListener("load", scrollToHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToHash);
      window.removeEventListener("load", scrollToHash);
    };
  }, []);

  return (
    <div className="app-shell" id="top">
      <AppHeader current="docs" />
      <main className="docs-main">
        <div className="site-container docs-shell">
          <aside className="docs-sidebar" aria-label="Documentation sections">
            <strong>Documentation</strong>
            <nav>
              {navigationGroups.map((group) => (
                <div className="docs-nav-group" key={group.label}>
                  <span>{group.label}</span>
                  {group.links.map(([id, label]) => (
                    <a
                      key={id}
                      className={id === "overview" ? "is-current" : undefined}
                      href={`#${id}`}
                    >
                      {label}
                    </a>
                  ))}
                </div>
              ))}
            </nav>
          </aside>

          <div className="docs-content">
            <section className="docs-language-picker" aria-labelledby="code-language-title">
              <div>
                <span>Code language</span>
                <strong id="code-language-title">Choose your implementation</strong>
              </div>
              <div className="docs-language-tabs" role="tablist" aria-label="Code language">
                {documentationLanguages.map((language) => {
                  const available = language.status === "Available";
                  return (
                    <button
                      key={language.id}
                      className={available ? "is-current" : undefined}
                      type="button"
                      role="tab"
                      aria-selected={available}
                      aria-controls="api-reference"
                      disabled={!available}
                      title={
                        available
                          ? `${language.label} examples are available`
                          : `${language.label} examples will be added with the SDK`
                      }
                    >
                      <span>{language.label}</span>
                      <small>{language.status}</small>
                    </button>
                  );
                })}
              </div>
              <a className="text-link" href="#languages">
                Language roadmap <ArrowRight aria-hidden="true" />
              </a>
            </section>

            <section className="docs-overview" id="overview">
              <div className="docs-intro">
                <span className="docs-eyebrow">ProbaDeck v1 reference</span>
                <h1>Build deck probability you can explain.</h1>
                <p>
                  A general-purpose engine for any system built around an ordered deck: model card
                  identity, hidden order, observer knowledge, exact probability, and deterministic
                  state transitions without encoding the rules of one particular game.
                </p>
                <div className="install-command">
                  <code>pnpm add probadeck</code>
                  <CopyCodeButton text="pnpm add probadeck" />
                </div>
                <dl className="runtime-facts">
                  <div>
                    <dt>Package</dt>
                    <dd>ESM · side-effect free</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>Node 22.12+ · evergreen browsers</dd>
                  </div>
                  <div>
                    <dt>Types</dt>
                    <dd>TypeScript 5.0+</dd>
                  </div>
                </dl>
              </div>

              <div className="docs-code-block" id="quick-start" data-code-language="typescript">
                <div className="docs-code-heading">
                  <div>
                    <span className="code-language-badge">TypeScript / JavaScript</span>
                    <h2>Quick start</h2>
                    <p>Describe your cards, seed the deck, and ask one exact question.</p>
                  </div>
                  <CopyCodeButton text={quickStartCode} />
                </div>
                <pre>
                  <code>{quickStartCode}</code>
                </pre>
              </div>
            </section>

            <section className="docs-section" id="core-model">
              <div className="docs-section-heading">
                <span className="section-kicker">Concepts</span>
                <h2>Your domain supplies the cards. ProbaDeck supplies the model.</h2>
                <p>
                  Standard playing cards, trading cards, encounter decks, loot tables, flashcards,
                  draft pools, or a custom simulation all use the same small contract.
                </p>
              </div>
              <div className="concept-layout">
                <div className="concept-grid">
                  <article>
                    <span>01</span>
                    <h3>Arbitrary card data</h3>
                    <p>TCard can be any serializable or in-memory shape your application owns.</p>
                  </article>
                  <article>
                    <span>02</span>
                    <h3>Logical and physical identity</h3>
                    <p>
                      cardKey groups equivalent copies; instanceId distinguishes each physical copy.
                    </p>
                  </article>
                  <article>
                    <span>03</span>
                    <h3>Named classifiers</h3>
                    <p>Define any categories your queries need, including multi-value tags.</p>
                  </article>
                  <article>
                    <span>04</span>
                    <h3>Two zones</h3>
                    <p>Cards move between the ordered active pile and a drawn-card history.</p>
                  </article>
                </div>
                <CodeBlock code={cardModelCode} label="Caller-defined model" />
              </div>
              <div className="model-principles">
                <article>
                  <h3>Immutable transitions</h3>
                  <p>
                    Every operation returns <code>{`{ deck, output, event }`}</code>. It increments
                    revision once and leaves every earlier snapshot valid.
                  </p>
                </article>
                <article>
                  <h3>Exact or explicit failure</h3>
                  <p>
                    Hidden outcomes are represented as weighted hypotheses. If an operation would
                    cross maxHypotheses, it fails before consuming randomness—never approximates.
                  </p>
                </article>
                <article>
                  <h3>Knowledge is not state</h3>
                  <p>
                    The concrete order exists for correctness and replay. Probability queries use
                    only the information visible to the modeled observer.
                  </p>
                </article>
              </div>
            </section>

            <section className="docs-section" id="positions-targets">
              <div className="docs-section-heading">
                <span className="section-kicker">Shared primitives</span>
                <h2>Positions, ranges, placements, and targets</h2>
                <p>
                  Card indices, offsets, and insertion gaps are zero-based. Probability draw numbers
                  are the one intentional exception: they are 1-based.
                </p>
              </div>
              <div className="primitive-grid">
                <div>
                  <h3>Placement variants</h3>
                  <div className="compact-reference-list">
                    {placementVariants.map(([name, description]) => (
                      <article key={name}>
                        <code>{name}</code>
                        <p>{description}</p>
                      </article>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>CardTarget variants</h3>
                  <div className="compact-reference-list">
                    {targetVariants.map(([name, description]) => (
                      <article key={name}>
                        <code>{name}</code>
                        <p>{description}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
              <div className="docs-callout">
                <strong>Bounds behavior</strong>
                <p>
                  Operation bounds default to <code>error</code>. Choose <code>clamp</code>{" "}
                  explicitly to resolve to the nearest valid boundary; outputs report{" "}
                  <code>wasClamped</code>. IndexRange uses an inclusive start and exclusive end.
                  random-within uses inclusive startGap and endGap.
                </p>
              </div>
            </section>

            <div className="api-reference-heading" id="api-reference">
              <span className="section-kicker">Complete runtime API</span>
              <h2>Every public export, by job.</h2>
              <p>
                Signatures below match the TypeScript package. Optional values show their runtime
                defaults, and every entry includes a concrete call. Every thrown library error is a
                ProbaDeckError.
              </p>
            </div>

            {apiGroups.map((group) => (
              <section className="docs-section api-group" id={group.id} key={group.id}>
                <div className="api-group__heading">
                  <span>{String(group.entries.length).padStart(2, "0")} exports</span>
                  <h2>{group.label}</h2>
                  <p>{group.description}</p>
                </div>
                <div className="api-entry-list">
                  {group.entries.map((entry) => (
                    <ApiReferenceEntry entry={entry} key={entry.id} />
                  ))}
                </div>
              </section>
            ))}

            <section className="docs-section" id="types">
              <div className="docs-section-heading">
                <span className="section-kicker">Type reference</span>
                <h2>The complete exported type surface.</h2>
                <p>
                  All public types are exported from <code>probadeck</code>. Object fields are
                  readonly throughout the API.
                </p>
              </div>
              <div className="type-groups">
                {typeGroups.map((group) => (
                  <section key={group.label}>
                    <h3>{group.label}</h3>
                    <div className="type-table" role="table" aria-label={`${group.label} types`}>
                      {group.entries.map((entry) => (
                        <div
                          className="type-row"
                          role="row"
                          key={entry.name}
                          data-api-type={entry.name}
                        >
                          <code role="cell">{entry.name}</code>
                          <code role="cell">{entry.definition}</code>
                          <p role="cell">{entry.description}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className="docs-section" id="error-codes">
              <div className="docs-section-heading">
                <span className="section-kicker">Error reference</span>
                <h2>Stable codes for every failure category.</h2>
                <p>
                  Use <code>instanceof ProbaDeckError</code>, then branch on <code>error.code</code>
                  . Messages and details add diagnostic context but are not the stable programmatic
                  API.
                </p>
              </div>
              <div className="error-code-grid">
                {errorCodes.map(([code, description]) => (
                  <article key={code} data-error-code={code}>
                    <code>{code}</code>
                    <p>{description}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="docs-section language-docs" id="languages">
              <div className="docs-section-heading">
                <span className="section-kicker">Implementations</span>
                <h2>Language support</h2>
                <p>
                  One production implementation today, backed by a language-independent behavioral
                  contract for compatible ports.
                </p>
              </div>
              <div className="language-status">
                <article className="language-available">
                  <div className="language-mark">TS</div>
                  <div>
                    <h3>TypeScript / JavaScript</h3>
                    <strong>Available now</strong>
                    <p>ESM for Node.js 22.12+, evergreen browsers, and TypeScript 5.0+.</p>
                  </div>
                </article>
                <article>
                  <div className="language-mark">v1</div>
                  <div>
                    <h3>Rust, Python, Go, and others</h3>
                    <strong>Portable implementation targets</strong>
                    <p>
                      The normative v1 specification, JSON Schemas, and conformance fixtures define
                      compatible observable behavior. These implementations are not shipped yet.
                    </p>
                  </div>
                </article>
              </div>
              <div
                className="language-docs-strategy"
                aria-label="Multi-language documentation policy"
              >
                <article>
                  <span>01</span>
                  <h3>Shared semantics</h3>
                  <p>
                    Concepts, exactness, visibility, event behavior, and errors are documented once
                    because the portable contract is the same in every implementation.
                  </p>
                </article>
                <article>
                  <span>02</span>
                  <h3>SDK-authentic code</h3>
                  <p>
                    Installation commands, signatures, naming conventions, and examples are written
                    for each SDK rather than mechanically translating TypeScript.
                  </p>
                </article>
                <article>
                  <span>03</span>
                  <h3>Conformance-gated</h3>
                  <p>
                    A language becomes selectable only after its package and examples pass the v1
                    conformance fixtures. Until then, it remains visibly marked as planned.
                  </p>
                </article>
              </div>
              <div className="specification-note">
                <div>
                  <h3>A language-independent contract</h3>
                  <p>
                    The specification covers knowledge semantics, exactness, visibility, errors,
                    snapshots, event logs, replay, and portable PCG32 randomness.
                  </p>
                </div>
                <a className="text-link" href="/examples">
                  See the contract in action <ArrowRight aria-hidden="true" />
                </a>
              </div>
            </section>

            <section className="docs-cta">
              <div>
                <h2>Three examples. One open-ended model.</h2>
                <p>
                  Explore how the same primitives adapt to poker, trading cards, and a hidden-return
                  workflow—then bring your own deck.
                </p>
              </div>
              <a className="button button--primary button--large" href="/examples">
                Explore examples <ArrowRight aria-hidden="true" />
              </a>
            </section>
          </div>

          <aside className="docs-on-page" aria-label="On this page">
            <nav>
              <strong>On this page</strong>
              <a href="#core-model">Core model</a>
              <a href="#positions-targets">Positions &amp; targets</a>
              {apiGroups.map((group) => (
                <a href={`#${group.id}`} key={group.id}>
                  {group.label}
                </a>
              ))}
              <a href="#types">Types</a>
              <a href="#error-codes">Error codes</a>
              <a href="#languages">Languages</a>
            </nav>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
