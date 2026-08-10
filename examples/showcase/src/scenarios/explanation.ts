import type { CalculationNode, ProbabilityExplanation } from "probadeck";

function assertNever(value: never): never {
  throw new Error(`Unsupported explanation variant: ${JSON.stringify(value)}`);
}

function countReason(
  explanation: ProbabilityExplanation,
  reason: ProbabilityExplanation["matchingInstances"][number]["reason"],
): number {
  return explanation.matchingInstances.filter((instance) => instance.reason === reason).length;
}

function formulaSteps(node: CalculationNode): readonly string[] {
  switch (node.kind) {
    case "constant":
      return [node.reason];
    case "ratio":
      return [
        `${node.numerator.toString()} matching candidates are divided by ${node.denominator.toString()} possible candidates.`,
      ];
    case "hypergeometric-no-hit":
      return [
        `The no-match chance covers ${node.queriedLocations} positions from ${node.poolSize} unknown cards containing ${node.matchingCandidates} matches.`,
      ];
    case "product":
      return [
        "Independent unknown pools are multiplied before their results are combined.",
        ...node.terms.flatMap(formulaSteps),
      ];
    case "complement":
      return ["The no-match probability is subtracted from 1.", ...formulaSteps(node.term)];
    case "weighted-sum":
      return [
        `${node.terms.length} observer-knowledge cases are weighted by their exact likelihood and combined.`,
      ];
    default:
      return assertNever(node);
  }
}

function queryStep(explanation: ProbabilityExplanation): string {
  switch (explanation.query.kind) {
    case "next":
      return `The query checks the next active card at revision ${explanation.revision}.`;
    case "at-draw":
      return `The query checks the card at 1-based draw ${explanation.query.drawNumber} from revision ${explanation.revision}.`;
    case "within-draws":
      return `The query checks for at least one match in the next ${explanation.query.drawCount} active cards at revision ${explanation.revision}.`;
    default:
      return assertNever(explanation.query);
  }
}

export function explainProbability(
  explanation: ProbabilityExplanation,
  percentage: number,
): readonly string[] {
  const eligible =
    countReason(explanation, "candidate") + countReason(explanation, "deterministic-hit");
  const drawn = countReason(explanation, "drawn");
  const outside = countReason(explanation, "outside-query");
  const disposition = `${eligible} matching physical ${eligible === 1 ? "copy is" : "copies are"} eligible; ${drawn} already drawn and ${outside} outside the queried positions.`;
  const representativeFormula = explanation.hypotheses[0]?.formula ?? explanation.formula;
  const calculation = formulaSteps(representativeFormula);
  const weighted =
    explanation.hypotheses.length > 1
      ? [
          `${explanation.hypotheses.length} distinct observer-knowledge cases are combined without revealing hidden order.`,
        ]
      : [];
  const result = `Reduced exact result: ${explanation.result.numerator.toString()}/${explanation.result.denominator.toString()} (${percentage.toFixed(2)}%).`;

  return Object.freeze([
    queryStep(explanation),
    disposition,
    ...weighted,
    ...new Set(calculation),
    result,
  ]);
}
