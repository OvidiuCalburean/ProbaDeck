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
            draggable="false"
            src="/assets/cards/standard/back.png"
            style={{ transform: `translate(${index * 1.4}px, ${index * 2}px)` }}
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
