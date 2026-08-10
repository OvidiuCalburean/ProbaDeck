import { describe, expect, it } from "vitest";

import * as probadeck from "../src/index.js";

describe("probadeck package", () => {
  it("exposes an importable public entry point", () => {
    expect(probadeck).toMatchObject({
      createDeck: expect.any(Function),
      createSeededRandom: expect.any(Function),
      probabilityOfNext: expect.any(Function),
      shuffleDeck: expect.any(Function),
    });
  });
});
