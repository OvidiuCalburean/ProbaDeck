import { ONE } from "../math/fraction.js";
import type { ExactFraction } from "../types.js";

export type KnowledgeCell =
  | { readonly kind: "fixed"; readonly instanceId: string }
  | { readonly kind: "pool"; readonly poolId: string };

export interface UniformPool {
  readonly poolId: string;
  readonly candidates: readonly string[];
}

export interface KnowledgeHypothesis {
  readonly weight: ExactFraction;
  readonly active: readonly KnowledgeCell[];
  readonly drawn: readonly KnowledgeCell[];
  readonly pools: ReadonlyMap<string, UniformPool>;
}

export interface KnowledgeState {
  readonly hypotheses: readonly KnowledgeHypothesis[];
}

export function fixedCell(instanceId: string): KnowledgeCell {
  return Object.freeze({ kind: "fixed", instanceId });
}

export function poolCell(poolId: string): KnowledgeCell {
  return Object.freeze({ kind: "pool", poolId });
}

export function createInitialKnowledge(instanceIds: readonly string[]): KnowledgeState {
  return Object.freeze({
    hypotheses: Object.freeze([
      Object.freeze({
        weight: ONE,
        active: Object.freeze(instanceIds.map(fixedCell)),
        drawn: Object.freeze([]),
        pools: new Map(),
      }),
    ]),
  });
}

export function getKnowledgeCell(
  hypothesis: KnowledgeHypothesis,
  zone: "active" | "drawn",
  index: number,
): KnowledgeCell {
  const cell = zone === "active" ? hypothesis.active[index] : hypothesis.drawn[index];
  if (cell === undefined) {
    throw new RangeError(`Missing ${zone} knowledge cell at index ${index}.`);
  }
  return cell;
}
