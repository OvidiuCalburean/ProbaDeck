import { useEffect } from "react";

import { DocsPage } from "./pages/DocsPage.js";
import { ExamplesPage } from "./pages/ExamplesPage.js";
import { HomePage } from "./pages/HomePage.js";

function routeForPath(pathname: string) {
  if (pathname === "/docs" || pathname.startsWith("/docs/")) return "docs";
  if (pathname === "/examples" || pathname.startsWith("/examples/")) return "examples";
  return "home";
}

export function App() {
  const route = routeForPath(window.location.pathname);

  useEffect(() => {
    const titles = {
      docs: "Docs — ProbaDeck",
      examples: "Interactive examples — ProbaDeck",
      home: "ProbaDeck — Exact probability for partially known decks",
    } as const;
    document.title = titles[route];
  }, [route]);

  if (route === "docs") return <DocsPage />;
  if (route === "examples") return <ExamplesPage />;
  return <HomePage />;
}
