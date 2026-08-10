import { CaretDown, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { ProbabilityQuery } from "probadeck";

import type { ProbabilityRow, ProbabilityView, ScenarioSession } from "../scenarios/types.js";
import { explainProbability } from "../scenarios/explanation.js";

interface ProbabilityLedgerProps {
  readonly session: ScenarioSession;
  readonly view: ProbabilityView;
  readonly onQueryChange: (query: ProbabilityQuery) => void;
}

function formatPercentage(value: number): string {
  if (value === 0) return "0%";
  if (value < 0.01) return "<0.01%";
  return `${value.toFixed(2)}%`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported probability query: ${JSON.stringify(value)}`);
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? "card" : "cards"}`;
}

function queryLabel(query: ProbabilityQuery): string {
  switch (query.kind) {
    case "next":
      return "Next card";
    case "at-draw":
      return `Card at draw ${query.drawNumber}`;
    case "within-draws":
      return `At least once in next ${cardCountLabel(query.drawCount)}`;
    default:
      return assertNever(query);
  }
}

function queryHeading(query: ProbabilityQuery): string {
  switch (query.kind) {
    case "next":
      return "Next-card probabilities";
    case "at-draw":
      return `Probabilities for the card at draw ${query.drawNumber}`;
    case "within-draws":
      return `At-least-once probabilities in the next ${cardCountLabel(query.drawCount)}`;
    default:
      return assertNever(query);
  }
}

function queryHelp(query: ProbabilityQuery): string {
  switch (query.kind) {
    case "next":
      return "Which card could be at the top now?";
    case "at-draw":
      return `Which card could appear specifically at 1-based draw ${query.drawNumber}? Earlier draws are not assumed to miss.`;
    case "within-draws":
      return `What is the chance of seeing each card at least once among the next ${cardCountLabel(query.drawCount)}?`;
    default:
      return assertNever(query);
  }
}

function copyLabel(row: ProbabilityRow): string {
  return `${row.remainingCopies}/${row.totalCopies}`;
}

export function ProbabilityLedger({ session, view, onQueryChange }: ProbabilityLedgerProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [explainedCard, setExplainedCard] = useState<string | null>(null);
  const activeRows = useMemo(() => {
    const matchingRows = view.rows
      .filter((row) => row.remainingCopies > 0)
      .filter((row) => row.card.name.toLowerCase().includes(search.toLowerCase()));
    // eslint-disable-next-line unicorn/no-array-sort -- matchingRows is a fresh ES2022 array.
    return matchingRows.sort(
      (left, right) =>
        right.percentage - left.percentage || left.card.name.localeCompare(right.card.name),
    );
  }, [search, view.rows]);
  const visibleRows = expanded ? activeRows : activeRows.slice(0, 6);
  const first = activeRows[0];
  const allEqual =
    first !== undefined &&
    activeRows.every(
      (row) =>
        row.exact.numerator * first.exact.denominator ===
        first.exact.numerator * row.exact.denominator,
    );
  const explained = view.rows.find((row) => row.card.name === explainedCard);
  const explanationSteps =
    explained === undefined ? [] : explainProbability(explained.explanation, explained.percentage);
  const countValue =
    view.query.kind === "at-draw"
      ? view.query.drawNumber
      : view.query.kind === "within-draws"
        ? view.query.drawCount
        : 1;

  return (
    <aside className="probability-ledger" aria-labelledby="probability-title">
      <div className="ledger-heading">
        <span className="eyebrow">Exact probability ledger</span>
        <h2 id="probability-title">{queryHeading(view.query)}</h2>
      </div>

      <div className="query-controls" aria-label="Probability query">
        <button
          className={view.query.kind === "next" ? "is-active" : ""}
          type="button"
          onClick={() => onQueryChange({ kind: "next" })}
        >
          Next card
        </button>
        <button
          className={view.query.kind === "at-draw" ? "is-active" : ""}
          type="button"
          onClick={() => onQueryChange({ kind: "at-draw", drawNumber: countValue })}
        >
          At draw N
        </button>
        <button
          className={view.query.kind === "within-draws" ? "is-active" : ""}
          type="button"
          onClick={() =>
            onQueryChange({ kind: "within-draws", drawCount: Math.max(1, countValue) })
          }
        >
          In next N
        </button>
        {view.query.kind === "next" ? null : (
          <label className="query-count">
            <span>N</span>
            <input
              aria-label="Draw count"
              max={session.deck.length}
              min={view.query.kind === "within-draws" ? 0 : 1}
              type="number"
              value={countValue}
              onChange={(changeEvent) => {
                const value = Number(changeEvent.target.value);
                onQueryChange(
                  view.query.kind === "at-draw"
                    ? { kind: "at-draw", drawNumber: value }
                    : { kind: "within-draws", drawCount: value },
                );
              }}
            />
          </label>
        )}
      </div>
      <p className="query-hint">{queryHelp(view.query)}</p>

      <div className="probability-highlight">
        {view.classifier === null ? (
          <>
            <span>
              {allEqual ? "Every remaining physical card" : (first?.card.name ?? "No cards remain")}
            </span>
            <strong>
              {first === undefined
                ? "0/1 · 0%"
                : `${first.exactLabel} · ${formatPercentage(first.percentage)}`}
            </strong>
          </>
        ) : (
          <>
            <span>Land classifier · {queryLabel(view.query).toLowerCase()}</span>
            <strong>
              {view.classifier.exactLabel} · {formatPercentage(view.classifier.percentage)}
            </strong>
            <small>
              Resolved through the named <code>type: Land</code> classifier.
            </small>
          </>
        )}
      </div>

      <label className="search-field">
        <MagnifyingGlass aria-hidden="true" size={18} />
        <span className="sr-only">Search remaining cards</span>
        <input
          placeholder="Search remaining cards…"
          type="search"
          value={search}
          onChange={(changeEvent) => setSearch(changeEvent.target.value)}
        />
      </label>

      <div className="probability-table" role="table" aria-label="Card probabilities">
        <div className="probability-row probability-row--header" role="row">
          <span role="columnheader">Card</span>
          <span role="columnheader">Copies</span>
          <span role="columnheader">Exact</span>
          <span role="columnheader">Percent</span>
        </div>
        {visibleRows.map((row) => (
          <button
            className={
              explainedCard === row.card.name ? "probability-row is-explained" : "probability-row"
            }
            key={row.card.name}
            role="row"
            type="button"
            onClick={() => setExplainedCard(explainedCard === row.card.name ? null : row.card.name)}
          >
            <span className="probability-card" role="cell">
              <img alt="" src={row.card.imagePath} />
              <span>{row.card.name}</span>
            </span>
            <span role="cell">{copyLabel(row)}</span>
            <span role="cell">{row.exactLabel}</span>
            <span role="cell">{formatPercentage(row.percentage)}</span>
          </button>
        ))}
      </div>

      {explained === undefined ? null : (
        <div className="explanation-card">
          <strong>How ProbaDeck got {explained.exactLabel}</strong>
          <ol>
            {explanationSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {activeRows.length <= 6 ? null : (
        <button className="view-all" type="button" onClick={() => setExpanded(!expanded)}>
          <span>
            {expanded
              ? "Show compact ledger"
              : `View all ${activeRows.length} remaining logical cards`}
          </span>
          {expanded ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}
        </button>
      )}
    </aside>
  );
}
