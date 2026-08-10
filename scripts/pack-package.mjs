import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageRoot = join(repositoryRoot, "packages", "typescript");
const artifactsDirectory = join(repositoryRoot, "artifacts");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

if (
  typeof packageJson !== "object" ||
  packageJson === null ||
  !("name" in packageJson) ||
  typeof packageJson.name !== "string" ||
  !("version" in packageJson) ||
  typeof packageJson.version !== "string"
) {
  throw new TypeError("Package metadata must include a string name and version.");
}

const archiveName = `${packageJson.name.replaceAll("@", "").replaceAll("/", "-")}-${packageJson.version}.tgz`;

mkdirSync(artifactsDirectory, { recursive: true });
execFileSync("pnpm", ["pack", "--pack-destination", artifactsDirectory], {
  cwd: packageRoot,
  stdio: "inherit",
});

const archivePath = join(artifactsDirectory, archiveName);
if (!existsSync(archivePath)) {
  throw new Error(`pnpm pack did not create ${archivePath}.`);
}

console.log(`Installable package: ${archivePath}`);
