import { Eye, Lock, Shuffle, StackSimple } from "@phosphor-icons/react";

import type { ScenarioEvent } from "../scenarios/types.js";

function EventIcon({ event }: { readonly event: ScenarioEvent }) {
  if (event.title.toLowerCase().includes("shuffle")) {
    return <Shuffle aria-hidden="true" size={18} />;
  }
  if (event.title.toLowerCase().includes("draw") || event.title.toLowerCase().includes("deal")) {
    return <Eye aria-hidden="true" size={18} />;
  }
  if (event.title.toLowerCase().includes("return") || event.title.toLowerCase().includes("move")) {
    return <Lock aria-hidden="true" size={18} />;
  }
  return <StackSimple aria-hidden="true" size={18} />;
}

export function EventTimeline({ events }: { readonly events: readonly ScenarioEvent[] }) {
  const visibleEvents = events.slice(-5);

  return (
    <section className="timeline-section" aria-labelledby="timeline-title">
      <div className="timeline-heading">
        <span className="eyebrow">Replayable event log</span>
        <h2 id="timeline-title">What the deck knows, revision by revision</h2>
      </div>
      <ol className="event-timeline">
        {visibleEvents.map((entry, index) => (
          <li key={entry.id}>
            <span className="event-number">
              {String(events.length - visibleEvents.length + index).padStart(2, "0")}
            </span>
            <div className="event-copy">
              <span className="event-title">
                <EventIcon event={entry} />
                <strong>{entry.title}</strong>
              </span>
              <p>{entry.detail}</p>
              <small>revision {entry.revision}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
