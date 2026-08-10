import {
  addFractions,
  complementFraction,
  fraction,
  multiplyFractions,
  ONE,
  ZERO,
} from "../math/fraction.js";
import type { CalculationNode, ExactFraction, HypothesisExplanation } from "../types.js";

export function constantNode(value: ExactFraction, reason: string): CalculationNode {
  return Object.freeze({ kind: "constant", value, reason });
}

export function ratioNode(numerator: bigint, denominator: bigint, reason: string): CalculationNode {
  return Object.freeze({
    kind: "ratio",
    numerator,
    denominator,
    value: fraction(numerator, denominator),
    reason,
  });
}

export function hypergeometricNoHitNode(
  poolSize: number,
  matchingCandidates: number,
  queriedLocations: number,
  numerator: bigint,
  denominator: bigint,
): CalculationNode {
  return Object.freeze({
    kind: "hypergeometric-no-hit",
    poolSize,
    matchingCandidates,
    queriedLocations,
    value: fraction(numerator, denominator),
  });
}

export function productNode(terms: readonly CalculationNode[]): CalculationNode {
  const value = terms.reduce((product, term) => multiplyFractions(product, term.value), ONE);
  return Object.freeze({ kind: "product", terms: Object.freeze([...terms]), value });
}

export function complementNode(term: CalculationNode): CalculationNode {
  return Object.freeze({ kind: "complement", term, value: complementFraction(term.value) });
}

function calculationSignature(node: CalculationNode): string {
  return JSON.stringify(node, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

export function groupHypothesisExplanations(
  explanations: readonly HypothesisExplanation[],
): readonly HypothesisExplanation[] {
  const groups = new Map<string, HypothesisExplanation>();
  for (const explanation of explanations) {
    const signature = `${explanation.conditionalProbability.numerator}/${explanation.conditionalProbability.denominator}:${calculationSignature(explanation.formula)}`;
    const current = groups.get(signature);
    groups.set(
      signature,
      current === undefined
        ? explanation
        : Object.freeze({
            ...current,
            weight: addFractions(current.weight, explanation.weight),
          }),
    );
  }
  return Object.freeze([...groups.values()]);
}

export function weightedSumNode(explanations: readonly HypothesisExplanation[]): CalculationNode {
  let value = ZERO;
  const terms = explanations.map((explanation) => {
    value = addFractions(
      value,
      multiplyFractions(explanation.weight, explanation.conditionalProbability),
    );
    return Object.freeze({
      weight: explanation.weight,
      conditional: explanation.conditionalProbability,
    });
  });
  return Object.freeze({ kind: "weighted-sum", terms: Object.freeze(terms), value });
}
