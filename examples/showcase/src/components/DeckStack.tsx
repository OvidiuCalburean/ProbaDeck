interface DeckStackProps {
  readonly count: number;
  readonly label: string;
}

export function DeckStack({ count, label }: DeckStackProps) {
  return (
    <div className="deck-stack-block" aria-label={`${count} cards in ${label}`}>
      <div className="deck-stack" aria-hidden="true">
        {Array.from({ length: 6 }, (_value, index) => (
          <img
            key={index}
            alt=""
            decoding="async"
            draggable="false"
            height={314}
            src="/assets/cards/standard/back.webp"
            style={{ transform: `translate(${index * 1.4}px, ${index * 2}px)` }}
            width={226}
          />
        ))}
      </div>
      <div>
        <strong>{count}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
