import { CubeTransparent } from "@phosphor-icons/react";

export type SiteSection = "home" | "examples" | "docs";

interface AppHeaderProps {
  readonly current: SiteSection;
}

const navigation: ReadonlyArray<{
  readonly href: string;
  readonly label: string;
  readonly id: SiteSection;
}> = [
  { id: "home", label: "Home", href: "/" },
  { id: "examples", label: "Examples", href: "/examples" },
  { id: "docs", label: "Docs", href: "/docs" },
];

export function AppHeader({ current }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="ProbaDeck home">
        <CubeTransparent aria-hidden="true" size={38} weight="thin" />
        <span>ProbaDeck</span>
      </a>
      <nav aria-label="Primary navigation">
        {navigation.map((item) => (
          <a
            key={item.id}
            className={current === item.id ? "is-current" : undefined}
            href={item.href}
            aria-current={current === item.id ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
