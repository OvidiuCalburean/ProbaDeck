import type { CardInstance } from "probadeck";

import type { DemoCard } from "../scenarios/types.js";

interface CardFaceProps {
  readonly instance: CardInstance<DemoCard>;
  readonly priority?: boolean;
  readonly selected?: boolean;
  readonly selectable?: boolean;
  readonly compact?: boolean;
  readonly onSelect?: (instanceId: string) => void;
}

export function CardFace({
  instance,
  priority = false,
  selected = false,
  selectable = false,
  compact = false,
  onSelect,
}: CardFaceProps) {
  const card = (
    <span
      className={`card-face card-face--${instance.card.game}${compact ? " is-compact" : ""}`}
      title={instance.card.name}
    >
      <img
        alt={instance.card.name}
        decoding="async"
        draggable="false"
        fetchPriority={priority ? "high" : "low"}
        height={314}
        loading={priority ? "eager" : "lazy"}
        src={instance.card.imagePath}
        width={226}
      />
      {instance.card.game === "holdem" ? null : (
        <span className="card-caption">{instance.card.name}</span>
      )}
    </span>
  );

  if (!selectable) return card;

  return (
    <button
      className={selected ? "card-button is-selected" : "card-button"}
      aria-label={`Select ${instance.card.name}`}
      aria-pressed={selected}
      type="button"
      onClick={() => onSelect?.(instance.instanceId)}
    >
      {card}
    </button>
  );
}
