import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = path.join(root, "dist", "client");

async function read(relativePath) {
  return readFile(path.join(client, relativePath), "utf8");
}

async function directoryMetrics(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const metrics = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? directoryMetrics(entryPath)
        : { files: 1, size: (await stat(entryPath)).size };
    }),
  );
  return metrics.reduce(
    (total, entry) => ({ files: total.files + entry.files, size: total.size + entry.size }),
    { files: 0, size: 0 },
  );
}

await test("pre-renders every public route with route-specific metadata", async () => {
  const [home, docs, examples, notFound] = await Promise.all([
    read("index.html"),
    read("docs/index.html"),
    read("examples/index.html"),
    read("404.html"),
  ]);

  assert.match(home, /Exact probabilities for decks you only partly know\./);
  assert.match(home, /<link rel="canonical" href="https:\/\/probadeck\.com\/"/);
  assert.match(home, /href="\/examples\/"/);
  assert.match(home, /href="\/docs\/"/);
  assert.match(docs, /Build deck probability you can explain\./);
  assert.match(docs, /<title>Docs — ProbaDeck<\/title>/);
  assert.doesNotMatch(docs, /<astro-island/);
  assert.match(examples, /Which card could be at the top now\?/);
  assert.match(examples, /Exact answers from decks in motion\./);
  assert.match(examples, /<title>Interactive examples — ProbaDeck<\/title>/);
  assert.match(examples, /<table class="probability-table">/);
  assert.match(examples, /aria-label="Explain Ace of Clubs probability"/);
  assert.doesNotMatch(examples, /<button[^>]+role="row"/);
  assert.match(examples, /\/assets\/cards\/standard\/9S\.webp/);
  assert.match(notFound, /This card is not in the deck\./);
  for (const page of [home, docs, examples, notFound]) {
    assert.doesNotMatch(page, /rel="stylesheet"/);
  }
});

await test("emits crawler files and stays far below the flat-plan storage allowance", async () => {
  const [robots, sitemap, llms, metrics] = await Promise.all([
    read("robots.txt"),
    read("sitemap.xml"),
    read("llms.txt"),
    directoryMetrics(client),
  ]);

  assert.match(robots, /Sitemap: https:\/\/probadeck\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/probadeck\.com\/docs\/<\/loc>/);
  assert.match(llms, /^# ProbaDeck/m);
  assert.match(llms, /\[Documentation and API reference\]\(https:\/\/probadeck\.com\/docs\/\)/);
  assert.match(llms, /\[GitHub repository\]\(https:\/\/github\.com\/OvidiuCalburean\/ProbaDeck\)/);
  assert.ok(
    metrics.size < 50 * 1024 * 1024,
    `Static site is unexpectedly large: ${metrics.size} bytes`,
  );
  assert.ok(metrics.files < 500, `Static site has unexpectedly many files: ${metrics.files}`);
});
