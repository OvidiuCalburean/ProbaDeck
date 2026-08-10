import { CubeTransparent } from "@phosphor-icons/react";

export function AppHeader() {
  return (
    <header className="app-header">
      <a className="brand" href="#top" aria-label="ProbaDeck showcase home">
        <CubeTransparent aria-hidden="true" size={38} weight="thin" />
        <span>ProbaDeck</span>
      </a>
      <p className="header-tagline">Real decks. Exact knowledge.</p>
      <nav aria-label="Project links">
        <a href="#observer">Docs</a>
      </nav>
    </header>
  );
}
