import { ArrowSquareOut, CubeTransparent } from "@phosphor-icons/react";

interface SiteFooterProps {
  readonly variant?: "project" | "examples";
}

export function SiteFooter({ variant = "project" }: SiteFooterProps) {
  return (
    <footer className={`site-footer site-footer--${variant}`}>
      <div className="footer-brand">
        <CubeTransparent aria-hidden="true" size={28} weight="thin" />
        <strong>ProbaDeck</strong>
      </div>

      {variant === "examples" ? (
        <p>
          Non-commercial demonstration. Magic: The Gathering card data and images via Scryfall.
          Yu-Gi-Oh! data and locally cached images via YGOPRODeck. Standard card faces via Deck of
          Cards API. All trademarks and card artwork belong to their respective owners.
        </p>
      ) : (
        <p>
          Deterministic deck simulation and explainable exact probability for partially known decks.
          The interactive examples are non-commercial and retain their source attributions.
        </p>
      )}

      <nav aria-label="Footer navigation">
        <a href="/examples">Examples</a>
        <a href="/docs">Docs</a>
        <a
          href="https://github.com/OvidiuCalburean/ProbaDeck/blob/main/LICENSE"
          target="_blank"
          rel="noreferrer"
        >
          MIT License <ArrowSquareOut aria-hidden="true" />
        </a>
        {variant === "examples" ? (
          <>
            <a href="https://scryfall.com/docs/api" target="_blank" rel="noreferrer">
              Scryfall <ArrowSquareOut aria-hidden="true" />
            </a>
            <a href="https://ygoprodeck.com/api-guide/" target="_blank" rel="noreferrer">
              YGOPRODeck <ArrowSquareOut aria-hidden="true" />
            </a>
          </>
        ) : null}
      </nav>
    </footer>
  );
}
