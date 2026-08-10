import { CaretDown, Eye, Lock, Warning } from "@phosphor-icons/react";
import { useState } from "react";

import { getPrivilegedOrder } from "../scenarios/session.js";
import type { ScenarioSession } from "../scenarios/types.js";

interface ObserverBarProps {
  readonly session: ScenarioSession;
}

export function ObserverBar({ session }: ObserverBarProps) {
  const [showPrivileged, setShowPrivileged] = useState(false);
  const revealed = session.zones.hand.length + session.zones.community.length;
  const privileged = showPrivileged ? getPrivilegedOrder(session).slice(0, 8) : [];

  return (
    <section className="observer-section" id="observer" aria-label="Observer knowledge">
      <div className="observer-bar">
        <span className="observer-icon">
          <Eye aria-hidden="true" size={25} weight="duotone" />
        </span>
        <p>
          <strong>Observer knows</strong>
          <span>{revealed} revealed cards</span>
          <i aria-hidden="true">·</i>
          <span>{session.deck.length} active positions</span>
          <i aria-hidden="true">·</i>
          <span>hidden random outcomes remain undisclosed</span>
        </p>
        <button
          aria-expanded={showPrivileged}
          className="privileged-toggle"
          type="button"
          onClick={() => setShowPrivileged(!showPrivileged)}
        >
          <Lock aria-hidden="true" size={18} />
          {showPrivileged ? "Hide privileged order" : "Show privileged order"}
          <CaretDown aria-hidden="true" size={16} />
        </button>
      </div>
      {showPrivileged ? (
        <div className="privileged-panel">
          <Warning aria-hidden="true" size={22} weight="fill" />
          <p>
            <strong>Audit-only actual order.</strong> Opening this panel does not update the modeled
            observer or its probabilities.
          </p>
          <ol>
            {privileged.map((instance) => (
              <li key={instance.instanceId}>
                <img alt="" src={instance.card.imagePath} />
                <span>{instance.card.name}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
