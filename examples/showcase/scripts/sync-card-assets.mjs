import { copyFileSync, cpSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { magicDeck, tournamentSources, yugiohDeck } from "./card-sources.mjs";

const showcaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageRoot = mkdtempSync(path.join(tmpdir(), "probadeck-card-assets-"));
const stageAssets = path.join(stageRoot, "cards");
const outputAssets = path.join(showcaseRoot, "public", "assets", "cards");
const outputData = path.join(showcaseRoot, "src", "data");

const requestHeaders = {
  Accept: "application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "ProbaDeck showcase asset sync (https://github.com/probadeck)",
};

function assertDeckSize(deck, expected, label) {
  const size = deck.reduce((total, [, count]) => total + count, 0);
  if (size !== expected) {
    throw new Error(`${label} must contain ${expected} cards, received ${size}`);
  }
}

function slug(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function fetchChecked(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...requestHeaders, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response;
}

async function download(url, destination) {
  const response = await fetchChecked(url);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function mapWithConcurrency(values, limit, task) {
  const output = Array.from({ length: values.length });
  let nextIndex = 0;

  async function worker() {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= values.length) return;
    output[index] = await task(values[index], index);
    return worker();
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function writeJsonAtomically(fileName, value) {
  mkdirSync(outputData, { recursive: true });
  const temporary = path.join(stageRoot, fileName);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path.join(outputData, fileName));
}

async function syncMagic() {
  const response = await fetchChecked("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers: magicDeck.map(([name]) => ({ name })) }),
  });
  const payload = await response.json();
  if (!Array.isArray(payload.data) || payload.data.length !== magicDeck.length) {
    throw new Error("Scryfall did not resolve every Magic card in the winning deck");
  }

  const resolved = new Map(payload.data.map((card) => [card.name, card]));
  return mapWithConcurrency(magicDeck, 4, async ([name, count]) => {
    const card = resolved.get(name);
    const imageUris = card?.image_uris ?? card?.card_faces?.[0]?.image_uris;
    if (!card || !imageUris?.small || typeof card.type_line !== "string") {
      throw new Error(`Scryfall returned incomplete data for ${name}`);
    }
    const fileName = `${slug(name)}.jpg`;
    await download(imageUris.small, path.join(stageAssets, "magic", fileName));
    return {
      id: card.id,
      name,
      count,
      typeLine: card.type_line,
      imagePath: `/assets/cards/magic/${fileName}`,
      sourceUrl: card.scryfall_uri,
    };
  });
}

async function syncYugioh() {
  return mapWithConcurrency(yugiohDeck, 1, async ([name, count]) => {
    const endpoint = new URL("https://db.ygoprodeck.com/api/v7/cardinfo.php");
    endpoint.searchParams.set("name", name);
    const response = await fetchChecked(endpoint);
    const payload = await response.json();
    const card = payload.data?.[0];
    const image = card?.card_images?.[0];
    if (!card || !image?.image_url_small || typeof card.type !== "string") {
      throw new Error(`YGOPRODeck returned incomplete data for ${name}`);
    }
    const fileName = `${slug(name)}.jpg`;
    await download(image.image_url_small, path.join(stageAssets, "yugioh", fileName));
    const resolved = {
      id: String(card.id),
      name,
      count,
      typeLine: card.type,
      imagePath: `/assets/cards/yugioh/${fileName}`,
      sourceUrl: `https://ygoprodeck.com/card/${card.id}`,
    };
    await new Promise((resolve) => setTimeout(resolve, 90));
    return resolved;
  });
}

async function syncStandard() {
  const ranks = [
    ["A", "Ace"],
    ["2", "Two"],
    ["3", "Three"],
    ["4", "Four"],
    ["5", "Five"],
    ["6", "Six"],
    ["7", "Seven"],
    ["8", "Eight"],
    ["9", "Nine"],
    ["0", "Ten"],
    ["J", "Jack"],
    ["Q", "Queen"],
    ["K", "King"],
  ];
  const suits = [
    ["S", "Spades", "black"],
    ["H", "Hearts", "red"],
    ["D", "Diamonds", "red"],
    ["C", "Clubs", "black"],
  ];
  const cards = suits.flatMap(([suitCode, suit, color]) =>
    ranks.map(([rankCode, rank]) => ({
      id: `${rankCode}${suitCode}`,
      name: `${rank} of ${suit}`,
      count: 1,
      typeLine: "Standard playing card",
      rank,
      suit,
      color,
      imagePath: `/assets/cards/standard/${rankCode}${suitCode}.png`,
      sourceUrl: `https://deckofcardsapi.com/static/img/${rankCode}${suitCode}.png`,
    })),
  );

  await mapWithConcurrency(cards, 6, async (card) => {
    await download(
      card.sourceUrl,
      path.join(stageAssets, "standard", path.basename(card.imagePath)),
    );
    return card;
  });
  await download(
    "https://deckofcardsapi.com/static/img/back.png",
    path.join(stageAssets, "standard", "back.png"),
  );
  return cards;
}

async function main() {
  assertDeckSize(magicDeck, 60, "Magic main deck");
  assertDeckSize(yugiohDeck, 40, "Yu-Gi-Oh! main deck");

  const [magic, yugioh, standard] = await Promise.all([syncMagic(), syncYugioh(), syncStandard()]);

  mkdirSync(outputAssets, { recursive: true });
  cpSync(stageAssets, outputAssets, { recursive: true, force: true });
  writeJsonAtomically("magic.json", { tournament: tournamentSources.magic, cards: magic });
  writeJsonAtomically("yugioh.json", {
    tournament: tournamentSources.yugioh,
    cards: yugioh,
  });
  writeJsonAtomically("standard.json", { cards: standard });

  const proofPath = path.join(outputAssets, "sync-proof.txt");
  writeFileSync(
    path.join(stageRoot, "sync-proof.txt"),
    `ProbaDeck showcase card assets synchronized ${new Date().toISOString()}\n`,
    "utf8",
  );
  copyFileSync(path.join(stageRoot, "sync-proof.txt"), proofPath);

  process.stdout.write(
    `Synced ${standard.length} standard, ${magic.length} Magic, and ${yugioh.length} Yu-Gi-Oh! unique cards.\n`,
  );
}

await main();
