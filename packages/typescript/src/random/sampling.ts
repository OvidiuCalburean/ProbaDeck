import { fail } from "../errors.js";
import type { RandomDecision, RandomSource } from "../types.js";

const UINT32_RANGE = 0x1_0000_0000;
const MAX_REJECTIONS = 1_000_000;

export interface SampleResult {
  readonly value: number;
  readonly random: RandomSource;
  readonly decision: RandomDecision;
}

export interface ShuffleResult<T> {
  readonly values: readonly T[];
  readonly random: RandomSource;
  readonly decisions: readonly RandomDecision[];
}

export function requireRandom(random: RandomSource | undefined): RandomSource {
  if (random === undefined) {
    fail("RANDOM_SOURCE_REQUIRED", "This operation requires a random source.");
  }
  return random;
}

export function sampleBounded(random: RandomSource, upperExclusive: number): SampleResult {
  if (
    !Number.isSafeInteger(upperExclusive) ||
    upperExclusive < 1 ||
    upperExclusive > UINT32_RANGE
  ) {
    fail("INVALID_RANDOM_VALUE", "A random bound must be an integer from 1 through 2^32.", {
      upperExclusive,
    });
  }

  const threshold = UINT32_RANGE % upperExclusive;
  const words: number[] = [];
  let current = random;

  for (let rejected = 0; rejected <= MAX_REJECTIONS; rejected += 1) {
    const step = current.nextUint32();
    if (!Number.isInteger(step.value) || step.value < 0 || step.value >= UINT32_RANGE) {
      fail("INVALID_RANDOM_VALUE", "RandomSource.nextUint32() returned an invalid value.", {
        value: step.value,
      });
    }
    words.push(step.value);
    current = step.next;

    if (step.value >= threshold) {
      const value = step.value % upperExclusive;
      return Object.freeze({
        value,
        random: current,
        decision: Object.freeze({
          upperExclusive,
          words: Object.freeze(words),
          value,
        }),
      });
    }
  }

  /* v8 ignore next 8 -- only an adversarial source can reject more than one million words */
  return fail(
    "INVALID_RANDOM_VALUE",
    "Random source exceeded the rejection-sampling safety limit.",
    {
      maxRejections: MAX_REJECTIONS,
    },
  );
}

export function shuffleValues<T>(values: readonly T[], random: RandomSource): ShuffleResult<T> {
  const shuffled = [...values];
  const decisions: RandomDecision[] = [];
  let current = random;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = sampleBounded(current, index + 1);
    current = sample.random;
    decisions.push(sample.decision);
    const selected = shuffled[sample.value];
    const tail = shuffled[index];
    /* v8 ignore next -- bounded sampling and the loop index guarantee both array entries */
    if (selected === undefined || tail === undefined) {
      throw new Error("Shuffle selected an impossible array index.");
    }
    shuffled[index] = selected;
    shuffled[sample.value] = tail;
  }

  return Object.freeze({
    values: Object.freeze(shuffled),
    random: current,
    decisions: Object.freeze(decisions),
  });
}
