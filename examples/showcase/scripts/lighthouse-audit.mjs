#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const showcaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(showcaseRoot, "../..");
const port = Number(process.env.LIGHTHOUSE_PORT ?? 4175);
const runs = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const origin = `http://127.0.0.1:${port}`;
const routes = ["/", "/docs/", "/examples/", "/404.html"];
const categoryFloors = {
  accessibility: 1,
  "best-practices": 1,
  seo: 1,
  "agentic-browsing": 1,
};
const performanceFloors = {
  "/": 0.99,
  "/docs/": 0.99,
  "/examples/": 0.98,
  "/404.html": 0.99,
};

if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error(`LIGHTHOUSE_PORT must be an integer from 1024 to 65535; received ${port}`);
}
if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
  throw new Error(`LIGHTHOUSE_RUNS must be an integer from 1 to 5; received ${runs}`);
}

function runCommand(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal === null ? `code ${code}` : `signal ${signal}`}\n${stderr}`,
        ),
      );
    });
  });
}

async function waitForServer(preview) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Vite preview exited before ${origin} became ready.`);
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- readiness polling must remain sequential.
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    // eslint-disable-next-line no-await-in-loop -- this delay prevents a busy readiness loop.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Vite preview at ${origin}.`);
}

async function audit(route) {
  const { stdout } = await runCommand("pnpm", [
    "exec",
    "lighthouse",
    `${origin}${route}`,
    "--only-categories=performance,accessibility,best-practices,seo,agentic-browsing",
    "--output=json",
    "--output-path=stdout",
    "--quiet",
    "--max-wait-for-load=45000",
    "--chrome-flags=--headless --no-sandbox",
  ]);
  return JSON.parse(stdout.slice(stdout.indexOf("{")));
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function metric(report, id) {
  const value = report.audits[id]?.numericValue;
  if (typeof value !== "number") throw new Error(`Lighthouse did not report ${id}.`);
  return value;
}

const preview = spawn(
  "pnpm",
  [
    "exec",
    "vite",
    "preview",
    "--outDir",
    "dist/client",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: showcaseRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);

try {
  await waitForServer(preview);
  const failures = [];
  for (const route of routes) {
    const reports = [];
    for (let run = 1; run <= runs; run += 1) {
      process.stdout.write(`Lighthouse ${route} (${run}/${runs})... `);
      // eslint-disable-next-line no-await-in-loop -- parallel Lighthouse runs distort CPU metrics.
      reports.push(await audit(route));
      console.log("done");
    }

    const scores = Object.fromEntries(
      ["performance", ...Object.keys(categoryFloors)].map((category) => [
        category,
        median(
          reports.map((report) => {
            const score = report.categories[category]?.score;
            if (typeof score !== "number") {
              throw new Error(`Lighthouse did not report the ${category} category for ${route}.`);
            }
            return score;
          }),
        ),
      ]),
    );
    const metrics = {
      fcp: median(reports.map((report) => metric(report, "first-contentful-paint"))),
      lcp: median(reports.map((report) => metric(report, "largest-contentful-paint"))),
      tbt: median(reports.map((report) => metric(report, "total-blocking-time"))),
      cls: median(reports.map((report) => metric(report, "cumulative-layout-shift"))),
    };

    console.log(
      `${route.padEnd(12)} perf ${Math.round(scores.performance * 100)} · a11y ${Math.round(scores.accessibility * 100)} · best ${Math.round(scores["best-practices"] * 100)} · SEO ${Math.round(scores.seo * 100)} · agentic ${Math.round(scores["agentic-browsing"] * 100)} · LCP ${(metrics.lcp / 1000).toFixed(2)}s · TBT ${Math.round(metrics.tbt)}ms · CLS ${metrics.cls.toFixed(3)}`,
    );

    for (const [category, floor] of Object.entries(categoryFloors)) {
      if (scores[category] < floor) {
        failures.push(
          `${route} ${category} was ${Math.round(scores[category] * 100)}; expected at least ${Math.round(floor * 100)}`,
        );
      }
    }
    if (scores.performance < performanceFloors[route]) {
      failures.push(
        `${route} performance was ${Math.round(scores.performance * 100)}; expected at least ${Math.round(performanceFloors[route] * 100)}`,
      );
    }
    if (metrics.fcp > 1_800)
      failures.push(`${route} FCP was ${Math.round(metrics.fcp)}ms; expected at most 1800ms`);
    if (metrics.lcp > 2_500)
      failures.push(`${route} LCP was ${Math.round(metrics.lcp)}ms; expected at most 2500ms`);
    if (metrics.tbt > 100)
      failures.push(`${route} TBT was ${Math.round(metrics.tbt)}ms; expected at most 100ms`);
    if (metrics.cls > 0.01) failures.push(`${route} CLS was ${metrics.cls}; expected at most 0.01`);
  }

  if (failures.length > 0) {
    throw new Error(`Lighthouse budgets failed:\n- ${failures.join("\n- ")}`);
  }
} finally {
  preview.kill("SIGTERM");
}
