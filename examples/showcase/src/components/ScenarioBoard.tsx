import {
  ArrowClockwise,
  ArrowDown,
  ArrowLineDown,
  ArrowLineUp,
  Shuffle,
  Trophy,
} from "@phosphor-icons/react";

import type { ReturnPlacement, ScenarioSession } from "../scenarios/types.js";
import { CardFace } from "./CardFace.js";
import { DeckStack } from "./DeckStack.js";

interface ScenarioBoardProps {
  readonly session: ScenarioSession;
  readonly selectedInstanceId: string | null;
  readonly returnPlacement: ReturnPlacement;
  readonly onSelectCard: (instanceId: string) => void;
  readonly onPlacementChange: (placement: ReturnPlacement) => void;
  readonly onDraw: () => void;
  readonly onReturnCard: () => void;
  readonly onShuffle: () => void;
  readonly onReset: () => void;
}

function HoldemZones({ session }: { readonly session: ScenarioSession }) {
  return (
    <div className="table-zones table-zones--holdem">
      <section className="zone">
        <div className="zone-heading">
          <strong>Your hand</strong>
          <span>2 hole cards</span>
        </div>
        <div className="card-row">
          {session.zones.hand.map((instance) => (
            <CardFace key={instance.instanceId} instance={instance} />
          ))}
        </div>
      </section>
      <section className="zone zone--community">
        <div className="zone-heading">
          <strong>Community board</strong>
          <span>{session.zones.community.length} of 5</span>
        </div>
        <div className="card-row">
          {session.zones.community.map((instance) => (
            <CardFace key={instance.instanceId} instance={instance} />
          ))}
          {Array.from(
            { length: Math.max(0, 5 - session.zones.community.length) },
            (_value, index) => (
              <div className="card-placeholder" key={index}>
                {session.zones.community.length + index === 3 ? "Turn" : "River"}
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function TournamentHand({
  session,
  selectedInstanceId,
  onSelectCard,
}: Pick<ScenarioBoardProps, "session" | "selectedInstanceId" | "onSelectCard">) {
  return (
    <section className="zone tournament-hand">
      <div className="zone-heading">
        <strong>{session.definition.handLabel}</strong>
        <span>{session.zones.hand.length} revealed cards · choose one to return</span>
      </div>
      <div className="card-row card-row--tournament">
        {session.zones.hand.map((instance) => (
          <CardFace
            key={instance.instanceId}
            compact
            instance={instance}
            selectable
            selected={instance.instanceId === selectedInstanceId}
            onSelect={onSelectCard}
          />
        ))}
      </div>
    </section>
  );
}

function PlacementControl({
  deckLength,
  placement,
  onChange,
}: {
  readonly deckLength: number;
  readonly placement: ReturnPlacement;
  readonly onChange: (placement: ReturnPlacement) => void;
}) {
  return (
    <div className="placement-control" aria-label="Return position">
      <button
        className={placement.kind === "top" ? "is-active" : ""}
        type="button"
        onClick={() => onChange({ kind: "top" })}
      >
        <ArrowLineUp aria-hidden="true" /> Top
      </button>
      <button
        className={placement.kind === "position" ? "is-active" : ""}
        type="button"
        onClick={() =>
          onChange({
            kind: "position",
            position:
              placement.kind === "position" ? placement.position : Math.floor(deckLength / 2) + 1,
          })
        }
      >
        <ArrowDown aria-hidden="true" /> Position
      </button>
      {placement.kind === "position" ? (
        <label>
          <input
            aria-label="Position from top"
            max={deckLength + 1}
            min={1}
            type="number"
            value={placement.position}
            onChange={(changeEvent) => {
              const requestedPosition = Number.parseInt(changeEvent.currentTarget.value, 10);
              const position = Number.isNaN(requestedPosition)
                ? placement.position
                : Math.min(deckLength + 1, Math.max(1, requestedPosition));

              changeEvent.currentTarget.value = String(position);
              onChange({ kind: "position", position });
            }}
          />
        </label>
      ) : null}
      <button
        className={placement.kind === "bottom" ? "is-active" : ""}
        type="button"
        onClick={() => onChange({ kind: "bottom" })}
      >
        <ArrowLineDown aria-hidden="true" /> Bottom
      </button>
    </div>
  );
}

export function ScenarioBoard({
  session,
  selectedInstanceId,
  returnPlacement,
  onSelectCard,
  onPlacementChange,
  onDraw,
  onReturnCard,
  onShuffle,
  onReset,
}: ScenarioBoardProps) {
  const isHoldem = session.id === "holdem";
  const boardComplete = session.zones.community.length >= 5;
  const tournament = session.definition.tournament;
  const stateTitle =
    session.id === "holdem"
      ? `Texas Hold'em · ${session.zones.community.length === 3 ? "Flop" : session.zones.community.length === 4 ? "Turn" : "River"} dealt`
      : `${session.definition.label} · ${session.zones.hand.length}-card hand`;

  return (
    <section className="scenario-board" aria-labelledby="scenario-title">
      <div className="scenario-heading">
        <div>
          <span className="eyebrow">{session.definition.eyebrow}</span>
          <h1 id="scenario-title">{stateTitle}</h1>
          <p>{session.definition.description}</p>
        </div>
        <span className="seed-chip">seed {session.seed.toString()}</span>
      </div>

      {tournament === undefined ? null : (
        <a
          className="tournament-badge"
          href={tournament.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          <Trophy aria-hidden="true" size={18} weight="duotone" />
          <span>
            <strong>{tournament.archetype}</strong>
            {tournament.pilot} · {tournament.event}
          </span>
        </a>
      )}

      {isHoldem ? (
        <HoldemZones session={session} />
      ) : (
        <TournamentHand
          session={session}
          selectedInstanceId={selectedInstanceId}
          onSelectCard={onSelectCard}
        />
      )}

      <div className="deck-and-controls">
        <DeckStack count={session.deck.length} label={session.definition.deckLabel} />
        <div className="action-group">
          <button
            className="button button--primary"
            disabled={isHoldem ? boardComplete : session.deck.length === 0}
            type="button"
            onClick={onDraw}
          >
            <ArrowDown aria-hidden="true" size={20} />
            {isHoldem
              ? boardComplete
                ? "Board complete"
                : "Deal next community card"
              : "Draw from top"}
          </button>
          {isHoldem ? null : (
            <button className="button" type="button" onClick={onShuffle}>
              <Shuffle aria-hidden="true" size={20} /> Shuffle
            </button>
          )}
          <button className="button button--quiet" type="button" onClick={onReset}>
            <ArrowClockwise aria-hidden="true" size={20} /> Reset
          </button>
        </div>
      </div>

      {isHoldem ? null : (
        <div className="return-panel">
          <div>
            <strong>Return selected card</strong>
            <span>Its exact physical instance becomes known at the selected position.</span>
          </div>
          <PlacementControl
            deckLength={session.deck.length}
            placement={returnPlacement}
            onChange={onPlacementChange}
          />
          <button
            className="button button--dark"
            disabled={selectedInstanceId === null}
            type="button"
            onClick={onReturnCard}
          >
            Return to deck
          </button>
        </div>
      )}

      <div className="state-flow" aria-label="Current deck flow">
        <span>
          {session.definition.catalog.reduce((sum, card) => sum + card.count, 0)}-card deck
        </span>
        <i aria-hidden="true">→</i>
        <span>{session.zones.hand.length} in hand</span>
        {isHoldem ? (
          <>
            <i aria-hidden="true">→</i>
            <span>{session.zones.community.length}-card board</span>
          </>
        ) : null}
        <i aria-hidden="true">→</i>
        <span>{session.deck.length} remain</span>
      </div>
    </section>
  );
}
