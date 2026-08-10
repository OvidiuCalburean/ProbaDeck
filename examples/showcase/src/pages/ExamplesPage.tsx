import { useEffect, useMemo, useState } from "react";
import type { ProbabilityQuery } from "probadeck";

import { AppHeader } from "../components/AppHeader.js";
import { EventTimeline } from "../components/EventTimeline.js";
import { ObserverBar } from "../components/ObserverBar.js";
import { ProbabilityLedger } from "../components/ProbabilityLedger.js";
import { ScenarioBoard } from "../components/ScenarioBoard.js";
import { ScenarioTabs } from "../components/ScenarioTabs.js";
import { SiteFooter } from "../components/SiteFooter.js";
import {
  applyScenarioAction,
  createScenarioSession,
  getProbabilityView,
} from "../scenarios/session.js";
import type {
  ReturnPlacement,
  ScenarioAction,
  ScenarioId,
  ScenarioSession,
} from "../scenarios/types.js";

function createSessions(): Readonly<Record<ScenarioId, ScenarioSession>> {
  return {
    holdem: createScenarioSession("holdem", 42n),
    magic: createScenarioSession("magic", 42n),
    yugioh: createScenarioSession("yugioh", 42n),
  };
}

function scenarioFromHash(): ScenarioId {
  const candidate = window.location.hash.slice(1);
  return candidate === "magic" || candidate === "yugioh" ? candidate : "holdem";
}

export function ExamplesPage() {
  const [activeId, setActiveId] = useState<ScenarioId>(scenarioFromHash);
  const [sessions, setSessions] = useState(createSessions);
  const [query, setQuery] = useState<ProbabilityQuery>({ kind: "next" });
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [returnPlacement, setReturnPlacement] = useState<ReturnPlacement>({ kind: "top" });
  const [notice, setNotice] = useState<string | null>(null);
  const session = sessions[activeId];
  const probabilityView = useMemo(() => getProbabilityView(session, query), [query, session]);

  useEffect(() => {
    if (session.id === "holdem") {
      setSelectedInstanceId(null);
      return;
    }
    const selectedStillExists = session.zones.hand.some(
      (instance) => instance.instanceId === selectedInstanceId,
    );
    if (!selectedStillExists) {
      setSelectedInstanceId(session.zones.hand[0]?.instanceId ?? null);
    }
  }, [selectedInstanceId, session]);

  useEffect(() => {
    function updateScenarioFromHash() {
      setActiveId(scenarioFromHash());
      setQuery({ kind: "next" });
      setNotice(null);
    }

    window.addEventListener("hashchange", updateScenarioFromHash);
    return () => window.removeEventListener("hashchange", updateScenarioFromHash);
  }, []);

  function runAction(action: ScenarioAction) {
    setSessions((current) => {
      try {
        const next = applyScenarioAction(current[activeId], action);
        setNotice(next.events.at(-1)?.detail ?? null);
        return { ...current, [activeId]: next };
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return current;
      }
    });
  }

  function resetActiveScenario() {
    setSessions((current) => {
      const nextSeed = current[activeId].seed + 1n;
      return {
        ...current,
        [activeId]: createScenarioSession(activeId, nextSeed),
      };
    });
    setQuery({ kind: "next" });
    setSelectedInstanceId(null);
    setReturnPlacement({ kind: "top" });
    setNotice("Deck reshuffled and opening cards redealt.");
  }

  return (
    <div className="app-shell" id="top">
      <AppHeader current="examples" />
      <main className="examples-main">
        <ScenarioTabs
          activeId={activeId}
          onChange={(id) => {
            setActiveId(id);
            window.history.replaceState(null, "", `/examples#${id}`);
            setQuery({ kind: "next" });
            setNotice(null);
          }}
        />

        <div
          className="scenario-layout"
          id={`panel-${activeId}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeId}`}
        >
          <ScenarioBoard
            session={session}
            selectedInstanceId={selectedInstanceId}
            returnPlacement={returnPlacement}
            onSelectCard={setSelectedInstanceId}
            onPlacementChange={setReturnPlacement}
            onDraw={() => runAction({ kind: "draw" })}
            onReturnCard={() => {
              if (selectedInstanceId === null) return;
              runAction({
                kind: "return-card",
                instanceId: selectedInstanceId,
                placement: returnPlacement,
              });
            }}
            onShuffle={() => runAction({ kind: "shuffle" })}
            onReset={resetActiveScenario}
          />
          <ProbabilityLedger
            key={activeId}
            session={session}
            view={probabilityView}
            onQueryChange={setQuery}
          />
        </div>

        <div className="notice" aria-live="polite">
          {notice}
        </div>
        <ObserverBar key={`${activeId}-${session.seed.toString()}`} session={session} />
        <EventTimeline events={session.events} />

        {activeId === "magic" ? (
          <section className="typescript-strip" id="typescript">
            <div>
              <span className="eyebrow">The calculation behind the interface</span>
              <h2>Every number is a ProbaDeck result.</h2>
              <p>
                External card services provide only names, types, and images. The immutable deck
                state, seeded randomness, observer knowledge, exact fraction, and explanation all
                come from the TypeScript library.
              </p>
            </div>
            <pre aria-label="TypeScript example">
              <code>{`const result = probabilityOfNext(deck, {
  kind: "classifier",
  classifier: "type",
  value: "Land",
});

result.exact;       // { numerator, denominator }
result.explanation; // structured proof`}</code>
            </pre>
          </section>
        ) : null}
      </main>

      <SiteFooter variant="examples" />
    </div>
  );
}
