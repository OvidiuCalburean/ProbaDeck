import { CardsThree, Eye, MagicWand } from "@phosphor-icons/react";
import type { ComponentType } from "react";

import { getScenarioDefinition } from "../scenarios/session.js";
import type { ScenarioId } from "../scenarios/types.js";

const scenarioIds = ["holdem", "magic", "yugioh"] as const;
const icons: Readonly<Record<ScenarioId, ComponentType<{ size: number; weight: "thin" }>>> = {
  holdem: CardsThree,
  magic: MagicWand,
  yugioh: Eye,
};

interface ScenarioTabsProps {
  readonly activeId: ScenarioId;
  readonly onChange: (id: ScenarioId) => void;
}

export function ScenarioTabs({ activeId, onChange }: ScenarioTabsProps) {
  return (
    <section className="scenario-navigation" aria-label="Game scenarios">
      <div className="scenario-tabs" role="tablist">
        {scenarioIds.map((id) => {
          const definition = getScenarioDefinition(id);
          const Icon = icons[id];
          return (
            <button
              key={id}
              className={activeId === id ? "scenario-tab is-active" : "scenario-tab"}
              id={`tab-${id}`}
              role="tab"
              aria-controls={`panel-${id}`}
              aria-selected={activeId === id}
              type="button"
              onClick={() => onChange(id)}
            >
              <Icon aria-hidden="true" size={30} weight="thin" />
              <span>{definition.shortLabel}</span>
            </button>
          );
        })}
      </div>
      <p>Different games. Same engine. Exact probabilities from real deck knowledge.</p>
    </section>
  );
}
