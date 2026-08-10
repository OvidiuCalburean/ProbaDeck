import { describe, expect, it } from "vitest";

import { explainProbability } from "./explanation.js";
import { createScenarioSession, getProbabilityView } from "./session.js";

describe("plain-language probability explanations", () => {
  it("explains a next-card ratio from query through exact result", () => {
    const session = createScenarioSession("magic", 42n);
    const row = getProbabilityView(session, { kind: "next" }).rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    const steps = explainProbability(row.explanation, row.percentage);

    expect(steps[0]).toContain("next active card");
    expect(steps.join(" ")).toContain("matching physical");
    expect(steps.join(" ")).toContain("possible candidates");
    expect(steps.at(-1)).toContain("Reduced exact result");
    expect(Object.isFrozen(steps)).toBe(true);
  });

  it("explains an at-least-once query as a no-match complement", () => {
    const session = createScenarioSession("yugioh", 42n);
    const row = getProbabilityView(session, { kind: "within-draws", drawCount: 4 }).rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    const copy = explainProbability(row.explanation, row.percentage).join(" ");

    expect(copy).toContain("at least one match in the next 4 active cards");
    expect(copy).toContain("no-match chance");
    expect(copy).toContain("subtracted from 1");
  });
});
