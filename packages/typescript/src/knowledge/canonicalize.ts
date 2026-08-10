import { fail } from "../errors.js";
import {
  addFractions,
  divideFractions,
  fractionsEqual,
  ONE,
  sumFractions,
  ZERO,
} from "../math/fraction.js";
import {
  fixedCell,
  poolCell,
  type KnowledgeCell,
  type KnowledgeHypothesis,
  type KnowledgeState,
  type UniformPool,
} from "./state.js";

interface CanonicalHypothesis {
  readonly signature: string;
  readonly hypothesis: KnowledgeHypothesis;
}

function sortedBy<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  const result: T[] = [];
  for (const value of values) {
    const insertionIndex = result.findIndex((existing) => compare(value, existing) < 0);
    result.splice(insertionIndex === -1 ? result.length : insertionIndex, 0, value);
  }
  return result;
}

function cellLocationKey(zone: "active" | "drawn", index: number): string {
  return `${zone === "active" ? "a" : "d"}:${index}`;
}

function normalizeSingletonPools(hypothesis: KnowledgeHypothesis): KnowledgeHypothesis {
  const singletonIds = new Map<string, string>();
  for (const [poolId, pool] of hypothesis.pools) {
    if (pool.candidates.length === 1) {
      const instanceId = pool.candidates[0];
      /* v8 ignore next -- a length-one readonly string array necessarily has index zero */
      if (instanceId === undefined) {
        throw new Error(`Singleton pool '${poolId}' has no candidate.`);
      }
      singletonIds.set(poolId, instanceId);
    }
  }

  function normalizeCells(cells: readonly KnowledgeCell[]): readonly KnowledgeCell[] {
    return Object.freeze(
      cells.map((cell) => {
        if (cell.kind === "pool") {
          const instanceId = singletonIds.get(cell.poolId);
          if (instanceId !== undefined) {
            return fixedCell(instanceId);
          }
        }
        return cell;
      }),
    );
  }

  const pools = new Map([...hypothesis.pools].filter(([poolId]) => !singletonIds.has(poolId)));

  return Object.freeze({
    weight: hypothesis.weight,
    active: normalizeCells(hypothesis.active),
    drawn: normalizeCells(hypothesis.drawn),
    pools,
  });
}

function validateHypothesis(hypothesis: KnowledgeHypothesis): void {
  const locationsByPool = new Map<string, string[]>();
  const occupiedIds = new Set<string>();

  function inspectCells(cells: readonly KnowledgeCell[], zone: "active" | "drawn"): void {
    cells.forEach((cell, index) => {
      if (cell.kind === "fixed") {
        if (occupiedIds.has(cell.instanceId)) {
          throw new Error(`Instance '${cell.instanceId}' appears more than once in a hypothesis.`);
        }
        occupiedIds.add(cell.instanceId);
        return;
      }

      const locations = locationsByPool.get(cell.poolId) ?? [];
      locations.push(cellLocationKey(zone, index));
      locationsByPool.set(cell.poolId, locations);
    });
  }

  inspectCells(hypothesis.active, "active");
  inspectCells(hypothesis.drawn, "drawn");

  for (const [poolId, pool] of hypothesis.pools) {
    const locations = locationsByPool.get(poolId);
    if (
      locations === undefined ||
      locations.length !== pool.candidates.length ||
      locations.length === 0
    ) {
      throw new Error(`Pool '${poolId}' does not have matching candidate and location counts.`);
    }
    const uniqueCandidates = new Set(pool.candidates);
    if (uniqueCandidates.size !== pool.candidates.length) {
      throw new Error(`Pool '${poolId}' contains duplicate candidates.`);
    }
    for (const instanceId of pool.candidates) {
      if (occupiedIds.has(instanceId)) {
        throw new Error(`Instance '${instanceId}' appears in multiple knowledge components.`);
      }
      occupiedIds.add(instanceId);
    }
  }

  for (const poolId of locationsByPool.keys()) {
    if (!hypothesis.pools.has(poolId)) {
      throw new Error(`Knowledge references unknown pool '${poolId}'.`);
    }
  }
}

function canonicalizeHypothesis(rawHypothesis: KnowledgeHypothesis): CanonicalHypothesis {
  const hypothesis = normalizeSingletonPools(rawHypothesis);
  validateHypothesis(hypothesis);

  const locationsByPool = new Map<string, string[]>();
  function collect(cells: readonly KnowledgeCell[], zone: "active" | "drawn"): void {
    cells.forEach((cell, index) => {
      if (cell.kind === "pool") {
        const locations = locationsByPool.get(cell.poolId) ?? [];
        locations.push(cellLocationKey(zone, index));
        locationsByPool.set(cell.poolId, locations);
      }
    });
  }
  collect(hypothesis.active, "active");
  collect(hypothesis.drawn, "drawn");

  const descriptors = sortedBy(
    [...hypothesis.pools.values()].map((pool) => {
      const locations = locationsByPool.get(pool.poolId);
      /* v8 ignore next -- validation above guarantees every declared pool has a location */
      if (locations === undefined) {
        throw new Error(`Pool '${pool.poolId}' has no locations.`);
      }
      return {
        oldId: pool.poolId,
        candidates: sortedBy(pool.candidates, (left, right) => left.localeCompare(right)),
        locations,
      };
    }),
    (left, right) =>
      JSON.stringify([left.candidates, left.locations]).localeCompare(
        JSON.stringify([right.candidates, right.locations]),
      ),
  );

  const idMap = new Map<string, string>();
  const pools = new Map<string, UniformPool>();
  descriptors.forEach((descriptor, index) => {
    const poolId = `pool-${index + 1}`;
    idMap.set(descriptor.oldId, poolId);
    pools.set(poolId, Object.freeze({ poolId, candidates: Object.freeze(descriptor.candidates) }));
  });

  function rewriteCells(cells: readonly KnowledgeCell[]): readonly KnowledgeCell[] {
    return Object.freeze(
      cells.map((cell) => {
        if (cell.kind === "fixed") {
          return fixedCell(cell.instanceId);
        }
        const poolId = idMap.get(cell.poolId);
        /* v8 ignore next -- every referenced pool was validated and assigned a canonical ID */
        if (poolId === undefined) {
          throw new Error(`Missing canonical ID for pool '${cell.poolId}'.`);
        }
        return poolCell(poolId);
      }),
    );
  }

  const active = rewriteCells(hypothesis.active);
  const drawn = rewriteCells(hypothesis.drawn);
  const signature = JSON.stringify({
    active,
    drawn,
    pools: [...pools.values()].map((pool) => [pool.poolId, pool.candidates]),
  });

  return {
    signature,
    hypothesis: Object.freeze({ weight: hypothesis.weight, active, drawn, pools }),
  };
}

export function canonicalizeKnowledge(
  hypotheses: readonly KnowledgeHypothesis[],
  maxHypotheses: number,
): KnowledgeState {
  const merged = new Map<string, KnowledgeHypothesis>();

  for (const rawHypothesis of hypotheses) {
    if (rawHypothesis.weight.numerator === 0n) {
      continue;
    }
    const canonical = canonicalizeHypothesis(rawHypothesis);
    const prior = merged.get(canonical.signature);
    merged.set(
      canonical.signature,
      prior === undefined
        ? canonical.hypothesis
        : Object.freeze({
            ...prior,
            weight: addFractions(prior.weight, canonical.hypothesis.weight),
          }),
    );
  }

  if (merged.size === 0) {
    fail("IMPOSSIBLE_OBSERVATION", "No knowledge hypothesis is consistent with the observation.");
  }

  if (merged.size > maxHypotheses) {
    fail(
      "INFERENCE_LIMIT_EXCEEDED",
      `The operation would create ${merged.size} hypotheses, exceeding the limit of ${maxHypotheses}.`,
      { projectedHypotheses: merged.size, maxHypotheses },
    );
  }

  const totalWeight = sumFractions([...merged.values()].map((hypothesis) => hypothesis.weight));
  const normalized = [...merged.values()].map((hypothesis) =>
    Object.freeze({ ...hypothesis, weight: divideFractions(hypothesis.weight, totalWeight) }),
  );

  /* v8 ignore next -- exact rational normalization is algebraically guaranteed to sum to one */
  if (!fractionsEqual(sumFractions(normalized.map((hypothesis) => hypothesis.weight)), ONE)) {
    throw new Error("Canonical knowledge weights do not sum to one.");
  }

  return Object.freeze({ hypotheses: Object.freeze(normalized) });
}

export function combineWeight(
  hypothesis: KnowledgeHypothesis,
  numerator: bigint | number,
  denominator: bigint | number,
): KnowledgeHypothesis {
  if (BigInt(numerator) === 0n) {
    return Object.freeze({ ...hypothesis, weight: ZERO });
  }

  return Object.freeze({
    ...hypothesis,
    weight: {
      numerator: hypothesis.weight.numerator * BigInt(numerator),
      denominator: hypothesis.weight.denominator * BigInt(denominator),
    },
  });
}
