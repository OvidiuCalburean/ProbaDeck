import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  pnpm,
  ["--filter", "probadeck", "exec", "vitest", "run", "test/stress.test.ts"],
  {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PROBADECK_STRESS_RUNS: process.env.PROBADECK_STRESS_RUNS ?? "500",
      PROBADECK_STRESS_COMMANDS: process.env.PROBADECK_STRESS_COMMANDS ?? "80",
    },
    stdio: "inherit",
  },
);

if (result.error !== undefined) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
