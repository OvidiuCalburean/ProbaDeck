import { fail } from "../errors.js";
import { requireRandom, sampleBounded } from "../random/sampling.js";
import type {
  BoundsBehavior,
  IndexRange,
  Placement,
  RandomDecision,
  RandomSource,
} from "../types.js";

export interface ResolvedRange {
  readonly range: IndexRange;
  readonly wasClamped: boolean;
}

export interface ResolvedPlacement {
  readonly gap: number;
  readonly wasClamped: boolean;
  readonly random: RandomSource | undefined;
  readonly decision: RandomDecision | undefined;
}

export interface PlacementChoices {
  readonly gaps: readonly number[];
  readonly wasClamped: boolean;
}

function requireInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    fail("INVALID_POSITION", `${field} must be a safe integer.`, { field, value });
  }
}

function applyBounds(
  value: number,
  minimum: number,
  maximum: number,
  behavior: BoundsBehavior,
  field: string,
): { readonly value: number; readonly wasClamped: boolean } {
  requireInteger(value, field);
  if (value >= minimum && value <= maximum) {
    return { value, wasClamped: false };
  }
  if (behavior === "error") {
    fail("POSITION_OUT_OF_BOUNDS", `${field} is outside ${minimum}..${maximum}.`, {
      field,
      value,
      minimum,
      maximum,
    });
  }
  return {
    value: Math.max(minimum, Math.min(maximum, value)),
    wasClamped: true,
  };
}

export function resolveRange(
  range: IndexRange | undefined,
  length: number,
  behavior: BoundsBehavior = "error",
): ResolvedRange {
  if (range === undefined) {
    return Object.freeze({
      range: Object.freeze({ startIndex: 0, endIndexExclusive: length }),
      wasClamped: false,
    });
  }

  const start = applyBounds(range.startIndex, 0, length, behavior, "startIndex");
  const end = applyBounds(range.endIndexExclusive, 0, length, behavior, "endIndexExclusive");
  if (start.value > end.value) {
    fail("INVALID_REGION", "A range start cannot exceed its end.", {
      startIndex: start.value,
      endIndexExclusive: end.value,
    });
  }
  return Object.freeze({
    range: Object.freeze({ startIndex: start.value, endIndexExclusive: end.value }),
    wasClamped: start.wasClamped || end.wasClamped,
  });
}

export function resolvePlacement(
  placement: Placement,
  referenceLength: number,
  behavior: BoundsBehavior = "error",
  random: RandomSource | undefined,
): ResolvedPlacement {
  const choices = resolvePlacementChoices(placement, referenceLength, behavior);
  if (placement.kind === "random-within" && choices.gaps.length > 1) {
    const source = requireRandom(random);
    const sample = sampleBounded(source, choices.gaps.length);
    const gap = choices.gaps[sample.value];
    /* v8 ignore next -- bounded sampling always indexes the non-empty choice array */
    if (gap === undefined) {
      throw new Error("Random placement selected an impossible gap.");
    }
    return Object.freeze({
      gap,
      wasClamped: choices.wasClamped,
      random: sample.random,
      decision: sample.decision,
    });
  }

  const gap = choices.gaps[0];
  /* v8 ignore next -- every valid placement produces at least one gap */
  if (gap === undefined) {
    throw new Error("Placement did not produce a gap.");
  }
  return Object.freeze({
    gap,
    wasClamped: choices.wasClamped,
    random,
    decision: undefined,
  });
}

export function resolvePlacementChoices(
  placement: Placement,
  referenceLength: number,
  behavior: BoundsBehavior = "error",
): PlacementChoices {
  if (placement.kind === "random-within") {
    const start = applyBounds(placement.startGap, 0, referenceLength, behavior, "startGap");
    const end = applyBounds(placement.endGap, 0, referenceLength, behavior, "endGap");
    if (start.value > end.value) {
      fail("INVALID_REGION", "A random placement start cannot exceed its end.", {
        startGap: start.value,
        endGap: end.value,
      });
    }
    const gaps: number[] = [];
    for (let gap = start.value; gap <= end.value; gap += 1) {
      gaps.push(gap);
    }
    return Object.freeze({
      gaps: Object.freeze(gaps),
      wasClamped: start.wasClamped || end.wasClamped,
    });
  }

  const requested =
    placement.kind === "index"
      ? placement.index
      : placement.kind === "from-top"
        ? placement.offset
        : referenceLength - placement.offset;
  const resolved = applyBounds(requested, 0, referenceLength, behavior, placement.kind);
  return Object.freeze({
    gaps: Object.freeze([resolved.value]),
    wasClamped: resolved.wasClamped,
  });
}
