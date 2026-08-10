import { fail } from "../errors.js";
import { getKnowledgeCell, type KnowledgeHypothesis } from "../knowledge/state.js";
import { binomial } from "../math/combinatorics.js";
import { fractionToNumber, ONE, ZERO } from "../math/fraction.js";
import { asInternalDeck, type InternalDeck } from "../model/state.js";
import type {
  CalculationNode,
  CardTarget,
  Deck,
  ExactFraction,
  HypothesisExplanation,
  InstanceDisposition,
  InstanceDispositionReason,
  ProbabilityExplanation,
  ProbabilityQuery,
  ProbabilityResult,
} from "../types.js";
import {
  complementNode,
  constantNode,
  groupHypothesisExplanations,
  hypergeometricNoHitNode,
  productNode,
  ratioNode,
  weightedSumNode,
} from "./explanation.js";
import { instanceMatchesTarget, validateTarget } from "./targets.js";

interface QueryScope {
  readonly query: ProbabilityQuery;
  readonly indices: readonly number[];
  readonly cumulative: boolean;
}

function requireSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    fail("INVALID_COUNT", `${field} must be a safe integer.`, { field, value });
  }
}

function resolveScope(length: number, query: ProbabilityQuery): QueryScope {
  if (query.kind === "next") {
    if (length === 0) {
      fail("EMPTY_DECK", "Cannot query the next card of an empty deck.");
    }
    return { query, indices: Object.freeze([0]), cumulative: false };
  }
  if (query.kind === "at-draw") {
    requireSafeInteger(query.drawNumber, "drawNumber");
    if (query.drawNumber < 1 || query.drawNumber > length) {
      fail("INVALID_COUNT", `drawNumber must be from 1 through ${length}.`, {
        drawNumber: query.drawNumber,
        length,
      });
    }
    return {
      query,
      indices: Object.freeze([query.drawNumber - 1]),
      cumulative: false,
    };
  }

  requireSafeInteger(query.drawCount, "drawCount");
  if (query.drawCount < 0 || query.drawCount > length) {
    fail("INVALID_COUNT", `drawCount must be from 0 through ${length}.`, {
      drawCount: query.drawCount,
      length,
    });
  }
  return {
    query,
    indices: Object.freeze(Array.from({ length: query.drawCount }, (_value, index) => index)),
    cumulative: true,
  };
}

function matchingCandidates<TCard>(
  deck: InternalDeck<TCard>,
  candidateIds: readonly string[],
  target: CardTarget,
): number {
  let count = 0;
  for (const instanceId of candidateIds) {
    const instance = deck.instances.get(instanceId);
    /* v8 ignore next -- validated knowledge candidates always reference the instance registry */
    if (instance === undefined) {
      throw new Error(`Knowledge references unknown instance '${instanceId}'.`);
    }
    if (instanceMatchesTarget(instance, target)) {
      count += 1;
    }
  }
  return count;
}

function exactHypothesisProbability<TCard>(
  deck: InternalDeck<TCard>,
  hypothesis: KnowledgeHypothesis,
  index: number,
  target: CardTarget,
): { readonly value: ExactFraction; readonly formula: CalculationNode } {
  const cell = getKnowledgeCell(hypothesis, "active", index);
  if (cell.kind === "fixed") {
    const instance = deck.instances.get(cell.instanceId);
    /* v8 ignore next -- validated fixed cells always reference the instance registry */
    if (instance === undefined) {
      throw new Error(`Knowledge references unknown instance '${cell.instanceId}'.`);
    }
    const value = instanceMatchesTarget(instance, target) ? ONE : ZERO;
    return {
      value,
      formula: constantNode(value, value === ONE ? "fixed-match" : "fixed-miss"),
    };
  }

  const pool = hypothesis.pools.get(cell.poolId);
  /* v8 ignore next -- canonical knowledge validates every pool-cell reference */
  if (pool === undefined) {
    throw new Error(`Knowledge references missing pool '${cell.poolId}'.`);
  }
  const matches = matchingCandidates(deck, pool.candidates, target);
  const formula = ratioNode(
    BigInt(matches),
    BigInt(pool.candidates.length),
    "uniform-pool-position",
  );
  return { value: formula.value, formula };
}

function cumulativeHypothesisProbability<TCard>(
  deck: InternalDeck<TCard>,
  hypothesis: KnowledgeHypothesis,
  indices: readonly number[],
  target: CardTarget,
): { readonly value: ExactFraction; readonly formula: CalculationNode } {
  if (indices.length === 0) {
    return { value: ZERO, formula: constantNode(ZERO, "empty-prefix") };
  }

  const poolLocations = new Map<string, number>();
  for (const index of indices) {
    const cell = getKnowledgeCell(hypothesis, "active", index);
    if (cell.kind === "fixed") {
      const instance = deck.instances.get(cell.instanceId);
      /* v8 ignore next -- validated fixed cells always reference the instance registry */
      if (instance === undefined) {
        throw new Error(`Knowledge references unknown instance '${cell.instanceId}'.`);
      }
      if (instanceMatchesTarget(instance, target)) {
        return { value: ONE, formula: constantNode(ONE, "fixed-match-in-prefix") };
      }
    } else {
      poolLocations.set(cell.poolId, (poolLocations.get(cell.poolId) ?? 0) + 1);
    }
  }

  const factors: CalculationNode[] = [];
  for (const [poolId, locations] of poolLocations) {
    const pool = hypothesis.pools.get(poolId);
    /* v8 ignore next -- canonical knowledge validates every pool-cell reference */
    if (pool === undefined) {
      throw new Error(`Knowledge references missing pool '${poolId}'.`);
    }
    const matches = matchingCandidates(deck, pool.candidates, target);
    factors.push(
      hypergeometricNoHitNode(
        pool.candidates.length,
        matches,
        locations,
        binomial(pool.candidates.length - matches, locations),
        binomial(pool.candidates.length, locations),
      ),
    );
  }

  const noHit = productNode(factors);
  const formula = complementNode(noHit);
  return { value: formula.value, formula };
}

function locateInstanceReason(
  hypothesis: KnowledgeHypothesis,
  instanceId: string,
  queriedIndices: ReadonlySet<number>,
): InstanceDispositionReason {
  const fixedActive = hypothesis.active.findIndex(
    (cell) => cell.kind === "fixed" && cell.instanceId === instanceId,
  );
  if (fixedActive !== -1) {
    return queriedIndices.has(fixedActive) ? "deterministic-hit" : "outside-query";
  }
  if (hypothesis.drawn.some((cell) => cell.kind === "fixed" && cell.instanceId === instanceId)) {
    return "drawn";
  }

  for (const [poolId, pool] of hypothesis.pools) {
    if (!pool.candidates.includes(instanceId)) {
      continue;
    }
    const hasQueriedLocation = hypothesis.active.some(
      (cell, index) => cell.kind === "pool" && cell.poolId === poolId && queriedIndices.has(index),
    );
    if (hasQueriedLocation) {
      return "candidate";
    }
    const hasActiveLocation = hypothesis.active.some(
      (cell) => cell.kind === "pool" && cell.poolId === poolId,
    );
    return hasActiveLocation ? "no-queried-pool-location" : "drawn";
  }

  /* v8 ignore next -- every registered instance is required to occupy one knowledge component */
  throw new Error(`Knowledge does not place instance '${instanceId}'.`);
}

function instanceDispositions<TCard>(
  deck: InternalDeck<TCard>,
  target: CardTarget,
  indices: readonly number[],
): readonly InstanceDisposition[] {
  const queried = new Set(indices);
  const dispositions: InstanceDisposition[] = [];

  for (const instance of deck.instances.values()) {
    if (!instanceMatchesTarget(instance, target)) {
      continue;
    }
    const reasons = new Set(
      deck.knowledge.hypotheses.map((hypothesis) =>
        locateInstanceReason(hypothesis, instance.instanceId, queried),
      ),
    );
    let reason: InstanceDispositionReason;
    if (reasons.size > 1 || reasons.has("candidate")) {
      reason = "candidate";
    } else if (reasons.has("deterministic-hit")) {
      reason = "deterministic-hit";
    } else if (reasons.has("drawn")) {
      reason = "drawn";
    } else if (reasons.has("outside-query")) {
      reason = "outside-query";
    } else {
      reason = "no-queried-pool-location";
    }
    dispositions.push(Object.freeze({ instanceId: instance.instanceId, reason }));
  }

  return Object.freeze(dispositions);
}

function probability<TCard>(
  publicDeck: Deck<TCard>,
  target: CardTarget,
  query: ProbabilityQuery,
): ProbabilityResult {
  const deck = asInternalDeck(publicDeck);
  validateTarget(target, deck.config, deck.instances);
  const scope = resolveScope(deck.length, query);
  const rawExplanations: HypothesisExplanation[] = deck.knowledge.hypotheses.map((hypothesis) => {
    const conditional = scope.cumulative
      ? cumulativeHypothesisProbability(deck, hypothesis, scope.indices, target)
      : exactHypothesisProbability(
          deck,
          hypothesis,
          /* v8 ignore next -- next and exact-draw scopes always contain exactly one index */
          scope.indices[0] ?? 0,
          target,
        );
    return Object.freeze({
      weight: hypothesis.weight,
      conditionalProbability: conditional.value,
      formula: conditional.formula,
    });
  });
  const hypotheses = groupHypothesisExplanations(rawExplanations);
  const formula = weightedSumNode(hypotheses);
  const exact = formula.value;
  const explanation: ProbabilityExplanation = Object.freeze({
    schemaVersion: 1,
    revision: deck.revision,
    query: scope.query,
    target,
    result: exact,
    formula,
    hypotheses,
    matchingInstances: instanceDispositions(deck, target, scope.indices),
  });
  const decimal = fractionToNumber(exact);
  return Object.freeze({ exact, decimal, percentage: decimal * 100, explanation });
}

export function probabilityOfNext<TCard>(deck: Deck<TCard>, target: CardTarget): ProbabilityResult {
  return probability(deck, target, Object.freeze({ kind: "next" }));
}

export function probabilityAtDraw<TCard>(
  deck: Deck<TCard>,
  target: CardTarget,
  drawNumber: number,
): ProbabilityResult {
  return probability(deck, target, Object.freeze({ kind: "at-draw", drawNumber }));
}

export function probabilityWithinDraws<TCard>(
  deck: Deck<TCard>,
  target: CardTarget,
  drawCount: number,
): ProbabilityResult {
  return probability(deck, target, Object.freeze({ kind: "within-draws", drawCount }));
}
