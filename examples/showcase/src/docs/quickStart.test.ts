import { createContext, Script } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  createDeck,
  createSeededRandom,
  probabilityWithinDraws,
  shuffleDeck,
  type ProbabilityResult,
} from "probadeck";

import { quickStartBody, quickStartCode } from "./quickStart.js";

describe("documentation quick start", () => {
  it("executes the exact code body displayed on the documentation page", () => {
    const context = createContext({
      createDeck,
      createSeededRandom,
      probabilityWithinDraws,
      shuffleDeck,
    });
    new Script(`${quickStartBody}\nglobalThis.quickStartResult = result;`).runInContext(context);
    const result = (context as { quickStartResult?: ProbabilityResult }).quickStartResult;

    expect(quickStartCode).toContain(quickStartBody);
    expect(result?.exact).toEqual({ numerator: 3n, denominator: 10n });
    expect(result?.explanation.result).toEqual(result?.exact);
  });
});
