import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/App.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find((element) =>
    element.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button containing ${label} was not found`);
  }
  return match;
}

async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}

async function enterPosition(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Position from top"]');
  if (input === null) throw new Error("Position input was not found");
  await act(async () => {
    const didSetValue = Reflect.set(HTMLInputElement.prototype, "value", value, input);
    if (!didSetValue) throw new Error("Native input value setter could not be applied");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.querySelector<HTMLDivElement>("#root");
  if (container === null) throw new Error("Test root is missing");
  root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("showcase browser interactions", () => {
  it("deals the Texas turn and switches to the tournament-winning Magic deck", async () => {
    expect(document.body.textContent).toContain("47");
    expect(document.body.textContent).toContain("1/47");
    expect(document.body.textContent).not.toContain("Move top card to bottom");
    expect(document.body.textContent).not.toContain("Every number is a ProbaDeck result.");

    const initialDeal = Array.from(
      document.querySelectorAll<HTMLImageElement>(".card-face img"),
    ).map((image) => image.alt);
    await click("Reset");
    const redealt = Array.from(document.querySelectorAll<HTMLImageElement>(".card-face img")).map(
      (image) => image.alt,
    );
    expect(document.body.textContent).toContain("seed 43");
    expect(document.body.textContent).toContain("Deck reshuffled and opening cards redealt.");
    expect(redealt).toHaveLength(5);
    expect(redealt).not.toEqual(initialDeal);

    await click("Deal next community card");
    expect(document.body.textContent).toContain("4 of 5");
    expect(document.body.textContent).toContain("Dealt the turn");

    await click("Magic");
    expect(document.querySelector('nav[aria-label="Project links"]')?.textContent).toBe("Docs");
    expect(document.body.textContent).toContain("Nathan Steuer");
    expect(document.body.textContent).toContain("Land classifier");
    expect(document.body.textContent).toContain("Every number is a ProbaDeck result.");
    expect(document.body.textContent).toContain("53");

    await click("Yu-Gi-Oh!");
    expect(document.body.textContent).not.toContain("Every number is a ProbaDeck result.");
  });

  it("draws, returns, and shuffles while preserving tab-specific state", async () => {
    await click("Magic");
    await click("Draw from top");
    expect(document.body.textContent).toContain("8 revealed cards");

    await click("Position");
    const positionInput = await enterPosition("01");
    expect(positionInput.value).toBe("1");

    await click("Return to deck");
    expect(document.body.textContent).toContain("inserted at position 1 from the top");

    await click("Shuffle");
    expect(document.body.textContent).toContain("merged into a uniform pool");

    await click("Yu-Gi-Oh!");
    expect(document.body.textContent).toContain("Ryan Yu");
    expect(document.body.textContent).toContain("35");

    await click("Magic");
    expect(document.body.textContent).toContain("7 revealed cards");
  });
});
