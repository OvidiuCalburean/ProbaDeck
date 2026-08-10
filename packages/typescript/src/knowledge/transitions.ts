import { binomial, combinations } from "../math/combinatorics.js";
import { fraction, multiplyFractions } from "../math/fraction.js";
import { canonicalizeKnowledge } from "./canonicalize.js";
import {
  fixedCell,
  getKnowledgeCell,
  poolCell,
  type KnowledgeCell,
  type KnowledgeHypothesis,
  type KnowledgeState,
  type UniformPool,
} from "./state.js";

function replaceCell(
  cells: readonly KnowledgeCell[],
  index: number,
  replacement: KnowledgeCell,
): readonly KnowledgeCell[] {
  return Object.freeze(cells.map((cell, cellIndex) => (cellIndex === index ? replacement : cell)));
}

function conditionHypothesisExact(
  hypothesis: KnowledgeHypothesis,
  zone: "active" | "drawn",
  index: number,
  instanceId: string,
): KnowledgeHypothesis | undefined {
  const cell = getKnowledgeCell(hypothesis, zone, index);
  if (cell.kind === "fixed") {
    return cell.instanceId === instanceId ? hypothesis : undefined;
  }

  const pool = hypothesis.pools.get(cell.poolId);
  if (pool === undefined || !pool.candidates.includes(instanceId)) {
    return undefined;
  }

  const pools = new Map(hypothesis.pools);
  const remaining = pool.candidates.filter((candidate) => candidate !== instanceId);
  if (remaining.length === 0) {
    pools.delete(pool.poolId);
  } else {
    pools.set(
      pool.poolId,
      Object.freeze({ poolId: pool.poolId, candidates: Object.freeze(remaining) }),
    );
  }

  return Object.freeze({
    ...hypothesis,
    weight: multiplyFractions(hypothesis.weight, fraction(1, pool.candidates.length)),
    active:
      zone === "active"
        ? replaceCell(hypothesis.active, index, fixedCell(instanceId))
        : hypothesis.active,
    drawn:
      zone === "drawn"
        ? replaceCell(hypothesis.drawn, index, fixedCell(instanceId))
        : hypothesis.drawn,
    pools,
  });
}

export function conditionKnowledgeExact(
  knowledge: KnowledgeState,
  zone: "active" | "drawn",
  index: number,
  instanceId: string,
  maxHypotheses: number,
): KnowledgeState {
  const conditioned = knowledge.hypotheses.flatMap((hypothesis) => {
    const result = conditionHypothesisExact(hypothesis, zone, index, instanceId);
    return result === undefined ? [] : [result];
  });
  return canonicalizeKnowledge(conditioned, maxHypotheses);
}

export function conditionKnowledgeTarget(
  knowledge: KnowledgeState,
  zone: "active" | "drawn",
  index: number,
  matchingInstanceIds: ReadonlySet<string>,
  expectedMatch: boolean,
  maxHypotheses: number,
): KnowledgeState {
  const conditioned: KnowledgeHypothesis[] = [];

  for (const hypothesis of knowledge.hypotheses) {
    const cell = getKnowledgeCell(hypothesis, zone, index);
    if (cell.kind === "fixed") {
      if (matchingInstanceIds.has(cell.instanceId) === expectedMatch) {
        conditioned.push(hypothesis);
      }
      continue;
    }

    const pool = hypothesis.pools.get(cell.poolId);
    if (pool === undefined) {
      throw new Error(`Knowledge references missing pool '${cell.poolId}'.`);
    }
    for (const candidate of pool.candidates) {
      if (matchingInstanceIds.has(candidate) === expectedMatch) {
        const branch = conditionHypothesisExact(hypothesis, zone, index, candidate);
        /* v8 ignore next -- candidates are read from the same pool conditioned above */
        if (branch !== undefined) {
          conditioned.push(branch);
        }
      }
    }
  }

  return canonicalizeKnowledge(conditioned, maxHypotheses);
}

export function drawKnowledge(knowledge: KnowledgeState, count: number): KnowledgeState {
  return Object.freeze({
    hypotheses: Object.freeze(
      knowledge.hypotheses.map((hypothesis) =>
        Object.freeze({
          ...hypothesis,
          active: Object.freeze(hypothesis.active.slice(count)),
          drawn: Object.freeze([...hypothesis.drawn, ...hypothesis.active.slice(0, count)]),
        }),
      ),
    ),
  });
}

function randomizedCells(
  candidates: readonly string[],
  pools: Map<string, UniformPool>,
  poolId: string,
): readonly KnowledgeCell[] {
  if (candidates.length === 1) {
    const instanceId = candidates[0];
    /* v8 ignore next -- a length-one readonly string array necessarily has index zero */
    if (instanceId === undefined) {
      throw new Error("A one-card randomized component has no candidate.");
    }
    return Object.freeze([fixedCell(instanceId)]);
  }
  if (candidates.length === 0) {
    throw new Error("Cannot create an empty randomized component.");
  }
  pools.set(poolId, Object.freeze({ poolId, candidates: Object.freeze([...candidates]) }));
  return Object.freeze(candidates.map(() => poolCell(poolId)));
}

export function insertKnownKnowledge(
  knowledge: KnowledgeState,
  gap: number,
  instanceIds: readonly string[],
  randomOrder: boolean,
  maxHypotheses: number,
): KnowledgeState {
  const hypotheses = knowledge.hypotheses.map((hypothesis) => {
    const pools = new Map(hypothesis.pools);
    const inserted = randomOrder
      ? randomizedCells(instanceIds, pools, "__inserted__")
      : Object.freeze(instanceIds.map(fixedCell));
    return Object.freeze({
      ...hypothesis,
      active: Object.freeze([
        ...hypothesis.active.slice(0, gap),
        ...inserted,
        ...hypothesis.active.slice(gap),
      ]),
      pools,
    });
  });
  return canonicalizeKnowledge(hypotheses, maxHypotheses);
}

export function mixKnowledgeStates(
  states: readonly KnowledgeState[],
  maxHypotheses: number,
): KnowledgeState {
  if (states.length === 1) {
    const onlyState = states[0];
    /* v8 ignore next -- states.length is exactly one in this branch */
    if (onlyState === undefined) {
      throw new Error("Expected one knowledge state.");
    }
    return onlyState;
  }
  const choiceWeight = fraction(1, states.length);
  const hypotheses = states.flatMap((state) =>
    state.hypotheses.map((hypothesis) =>
      Object.freeze({
        ...hypothesis,
        weight: multiplyFractions(hypothesis.weight, choiceWeight),
      }),
    ),
  );
  return canonicalizeKnowledge(hypotheses, maxHypotheses);
}

interface SelectionBranch {
  readonly weight: KnowledgeHypothesis["weight"];
  readonly candidates: readonly string[];
  readonly pools: ReadonlyMap<string, UniformPool>;
}

function expandSelectedCandidates(
  hypothesis: KnowledgeHypothesis,
  selectedIndices: ReadonlySet<number>,
): readonly SelectionBranch[] {
  const fixedCandidates: string[] = [];
  const selectedByPool = new Map<string, number>();

  hypothesis.active.forEach((cell, index) => {
    if (!selectedIndices.has(index)) {
      return;
    }
    if (cell.kind === "fixed") {
      fixedCandidates.push(cell.instanceId);
    } else {
      selectedByPool.set(cell.poolId, (selectedByPool.get(cell.poolId) ?? 0) + 1);
    }
  });

  let branches: SelectionBranch[] = [
    {
      weight: hypothesis.weight,
      candidates: Object.freeze(fixedCandidates),
      pools: new Map(hypothesis.pools),
    },
  ];

  for (const [poolId, selectedCount] of selectedByPool) {
    const pool = hypothesis.pools.get(poolId);
    if (pool === undefined) {
      throw new Error(`Knowledge references missing pool '${poolId}'.`);
    }
    const subsets = combinations(pool.candidates, selectedCount);
    branches = branches.flatMap((branch) =>
      subsets.map((subset) => {
        const selected = new Set(subset);
        const remaining = pool.candidates.filter((candidate) => !selected.has(candidate));
        const pools = new Map(branch.pools);
        if (remaining.length === 0) {
          pools.delete(poolId);
        } else {
          pools.set(poolId, Object.freeze({ poolId, candidates: Object.freeze(remaining) }));
        }
        return {
          weight: multiplyFractions(branch.weight, fraction(1, subsets.length)),
          candidates: Object.freeze([...branch.candidates, ...subset]),
          pools,
        };
      }),
    );
  }

  return branches;
}

export function shuffleKnowledge(
  knowledge: KnowledgeState,
  startIndex: number,
  endIndexExclusive: number,
  maxHypotheses: number,
): KnowledgeState {
  if (endIndexExclusive - startIndex <= 1) {
    return knowledge;
  }
  const indices = new Set<number>();
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    indices.add(index);
  }

  const hypotheses = knowledge.hypotheses.flatMap((hypothesis) =>
    expandSelectedCandidates(hypothesis, indices).map((branch) => {
      const pools = new Map(branch.pools);
      const cells = randomizedCells(branch.candidates, pools, "__shuffled__");
      let selectedOffset = 0;
      const active = hypothesis.active.map((cell, index) => {
        if (!indices.has(index)) {
          return cell;
        }
        const replacement = cells[selectedOffset];
        selectedOffset += 1;
        /* v8 ignore next -- selected cells and generated replacements have identical counts */
        if (replacement === undefined) {
          throw new Error("Shuffle knowledge produced too few replacement cells.");
        }
        return replacement;
      });
      return Object.freeze({
        weight: branch.weight,
        active: Object.freeze(active),
        drawn: hypothesis.drawn,
        pools,
      });
    }),
  );

  return canonicalizeKnowledge(hypotheses, maxHypotheses);
}

export function moveKnowledgeByIndices(
  knowledge: KnowledgeState,
  indices: readonly number[],
  gap: number,
  randomOrder: boolean,
  maxHypotheses: number,
): KnowledgeState {
  const selectedIndices = new Set(indices);
  if (!randomOrder || indices.length <= 1) {
    const hypotheses = knowledge.hypotheses.map((hypothesis) => {
      const selected = hypothesis.active.filter((_cell, index) => selectedIndices.has(index));
      const remaining = hypothesis.active.filter((_cell, index) => !selectedIndices.has(index));
      return Object.freeze({
        ...hypothesis,
        active: Object.freeze([...remaining.slice(0, gap), ...selected, ...remaining.slice(gap)]),
      });
    });
    return canonicalizeKnowledge(hypotheses, maxHypotheses);
  }

  const hypotheses = knowledge.hypotheses.flatMap((hypothesis) => {
    const remaining = hypothesis.active.filter((_cell, index) => !selectedIndices.has(index));
    return expandSelectedCandidates(hypothesis, selectedIndices).map((branch) => {
      const pools = new Map(branch.pools);
      const selected = randomizedCells(branch.candidates, pools, "__moved__");
      return Object.freeze({
        weight: branch.weight,
        active: Object.freeze([...remaining.slice(0, gap), ...selected, ...remaining.slice(gap)]),
        drawn: hypothesis.drawn,
        pools,
      });
    });
  });
  return canonicalizeKnowledge(hypotheses, maxHypotheses);
}

export function moveKnowledgeByIndicesOrdered(
  knowledge: KnowledgeState,
  indices: readonly number[],
  gap: number,
  orderOffsets: readonly number[],
  maxHypotheses: number,
): KnowledgeState {
  const selectedIndices = new Set(indices);
  const hypotheses = knowledge.hypotheses.map((hypothesis) => {
    const selected = hypothesis.active.filter((_cell, index) => selectedIndices.has(index));
    const ordered = orderOffsets.map((offset) => {
      const cell = selected[offset];
      if (cell === undefined) {
        throw new Error(`Missing selected knowledge cell at order offset ${offset}.`);
      }
      return cell;
    });
    const remaining = hypothesis.active.filter((_cell, index) => !selectedIndices.has(index));
    return Object.freeze({
      ...hypothesis,
      active: Object.freeze([...remaining.slice(0, gap), ...ordered, ...remaining.slice(gap)]),
    });
  });
  return canonicalizeKnowledge(hypotheses, maxHypotheses);
}

function conditionIdInZone(
  hypothesis: KnowledgeHypothesis,
  zone: "active" | "drawn",
  instanceId: string,
): readonly KnowledgeHypothesis[] {
  const cells = zone === "active" ? hypothesis.active : hypothesis.drawn;
  const possibleIndices = cells.flatMap((cell, index) => {
    if (cell.kind === "fixed") {
      return cell.instanceId === instanceId ? [index] : [];
    }
    return hypothesis.pools.get(cell.poolId)?.candidates.includes(instanceId) === true
      ? [index]
      : [];
  });
  return possibleIndices.flatMap((index) => {
    const result = conditionHypothesisExact(hypothesis, zone, index, instanceId);
    /* v8 ignore next -- possibleIndices contains only locations that admit the instance */
    return result === undefined ? [] : [result];
  });
}

export function removeKnownInstancesFromZone(
  knowledge: KnowledgeState,
  sourceZone: "active" | "drawn",
  instanceIds: readonly string[],
  maxHypotheses: number,
): KnowledgeState {
  let branches = [...knowledge.hypotheses];
  for (const instanceId of instanceIds) {
    branches = branches.flatMap((hypothesis) =>
      conditionIdInZone(hypothesis, sourceZone, instanceId),
    );
  }

  const selectedIds = new Set(instanceIds);
  const removed = branches.map((hypothesis) => {
    const sourceCells = sourceZone === "active" ? hypothesis.active : hypothesis.drawn;
    const remaining = sourceCells.filter(
      (cell) => cell.kind !== "fixed" || !selectedIds.has(cell.instanceId),
    );
    return Object.freeze({
      ...hypothesis,
      active: sourceZone === "active" ? Object.freeze(remaining) : hypothesis.active,
      drawn: sourceZone === "drawn" ? Object.freeze(remaining) : hypothesis.drawn,
    });
  });
  return canonicalizeKnowledge(removed, maxHypotheses);
}

export function relocateKnownInstances(
  knowledge: KnowledgeState,
  sourceZone: "active" | "drawn",
  instanceIds: readonly string[],
  activeGap: number,
  randomOrder: boolean,
  maxHypotheses: number,
): KnowledgeState {
  let branches = [...knowledge.hypotheses];
  for (const instanceId of instanceIds) {
    branches = branches.flatMap((hypothesis) =>
      conditionIdInZone(hypothesis, sourceZone, instanceId),
    );
  }

  const selectedIds = new Set(instanceIds);
  const relocated = branches.map((hypothesis) => {
    const sourceCells = sourceZone === "active" ? hypothesis.active : hypothesis.drawn;
    const selected = sourceCells
      .flatMap((cell, index) =>
        cell.kind === "fixed" && selectedIds.has(cell.instanceId)
          ? [{ index, instanceId: cell.instanceId }]
          : [],
      )
      .map((entry) => entry.instanceId);
    const remainingSource = sourceCells.filter(
      (cell) => cell.kind !== "fixed" || !selectedIds.has(cell.instanceId),
    );
    const pools = new Map(hypothesis.pools);
    const inserted = randomOrder
      ? randomizedCells(selected, pools, "__relocated__")
      : Object.freeze(selected.map(fixedCell));
    const activeBase = sourceZone === "active" ? remainingSource : hypothesis.active;

    return Object.freeze({
      ...hypothesis,
      active: Object.freeze([
        ...activeBase.slice(0, activeGap),
        ...inserted,
        ...activeBase.slice(activeGap),
      ]),
      drawn: sourceZone === "drawn" ? Object.freeze(remainingSource) : hypothesis.drawn,
      pools,
    });
  });

  return canonicalizeKnowledge(relocated, maxHypotheses);
}

export function revealShuffleKnowledge(
  knowledge: KnowledgeState,
  startIndex: number,
  endIndexExclusive: number,
  actualInstanceIds: readonly string[],
  maxHypotheses: number,
): KnowledgeState {
  const actualSet = new Set(actualInstanceIds);
  const revealed: KnowledgeHypothesis[] = [];

  for (const hypothesis of knowledge.hypotheses) {
    const selectedCells = hypothesis.active.slice(startIndex, endIndexExclusive);
    const fixedSelected = selectedCells.flatMap((cell) =>
      cell.kind === "fixed" ? [cell.instanceId] : [],
    );
    if (fixedSelected.some((instanceId) => !actualSet.has(instanceId))) {
      continue;
    }

    const selectedCounts = new Map<string, number>();
    for (const cell of selectedCells) {
      if (cell.kind === "pool") {
        selectedCounts.set(cell.poolId, (selectedCounts.get(cell.poolId) ?? 0) + 1);
      }
    }

    let weight = hypothesis.weight;
    const pools = new Map(hypothesis.pools);
    const selectedCandidates = [...fixedSelected];
    let consistent = true;

    for (const [poolId, selectedCount] of selectedCounts) {
      const pool = hypothesis.pools.get(poolId);
      if (pool === undefined) {
        throw new Error(`Knowledge references missing pool '${poolId}'.`);
      }
      const chosen = pool.candidates.filter((candidate) => actualSet.has(candidate));
      if (chosen.length !== selectedCount) {
        consistent = false;
        break;
      }
      selectedCandidates.push(...chosen);
      const remaining = pool.candidates.filter((candidate) => !actualSet.has(candidate));
      if (remaining.length === 0) {
        pools.delete(poolId);
      } else {
        pools.set(poolId, Object.freeze({ poolId, candidates: Object.freeze(remaining) }));
      }
      weight = multiplyFractions(
        weight,
        fraction(1n, binomial(pool.candidates.length, selectedCount)),
      );
    }

    if (!consistent || new Set(selectedCandidates).size !== actualSet.size) {
      continue;
    }

    const active = [
      ...hypothesis.active.slice(0, startIndex),
      ...actualInstanceIds.map(fixedCell),
      ...hypothesis.active.slice(endIndexExclusive),
    ];
    revealed.push(
      Object.freeze({
        weight,
        active: Object.freeze(active),
        drawn: hypothesis.drawn,
        pools,
      }),
    );
  }

  return canonicalizeKnowledge(revealed, maxHypotheses);
}
