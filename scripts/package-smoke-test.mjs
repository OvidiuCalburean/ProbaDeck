import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageRoot = join(repositoryRoot, "packages", "typescript");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "probadeck-package-smoke-"));

try {
  execFileSync("pnpm", ["build"], { cwd: repositoryRoot, stdio: "inherit" });
  execFileSync("pnpm", ["pack", "--pack-destination", temporaryDirectory], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  const archive = readdirSync(temporaryDirectory).find((entry) => entry.endsWith(".tgz"));
  if (archive === undefined) {
    throw new Error("pnpm pack did not produce a tarball.");
  }
  writeFileSync(
    join(temporaryDirectory, "package.json"),
    JSON.stringify({ name: "probadeck-package-smoke", private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--cache",
      join(temporaryDirectory, "npm-cache"),
      join(temporaryDirectory, archive),
    ],
    {
      cwd: temporaryDirectory,
      stdio: "inherit",
    },
  );
  writeFileSync(
    join(temporaryDirectory, "consumer.mjs"),
    `import { createDeck, createSeededRandom, probabilityOfNext, shuffleDeck } from "probadeck";
const deck = createDeck({
  cards: [{ name: "target" }, { name: "other" }],
  config: { cardKey: (card) => card.name },
  random: createSeededRandom({ seed: 1n }),
});
const shuffled = shuffleDeck(deck).deck;
const result = probabilityOfNext(shuffled, { kind: "card-key", cardKey: "target" });
if (result.exact.numerator !== 1n || result.exact.denominator !== 2n) {
  throw new Error("Packed consumer received the wrong exact probability.");
}
console.log("packed ESM consumer: 1/2");
`,
  );
  execFileSync(process.execPath, [join(temporaryDirectory, "consumer.mjs")], {
    cwd: temporaryDirectory,
    stdio: "inherit",
  });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
