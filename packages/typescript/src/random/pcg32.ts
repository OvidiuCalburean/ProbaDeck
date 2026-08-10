import { fail } from "../errors.js";
import type { JsonObject, RandomSource, RandomStep } from "../types.js";

const MASK_64 = (1n << 64n) - 1n;
const MULTIPLIER = 6_364_136_223_846_793_005n;

function parseUnsigned64(value: bigint | string, field: string): bigint {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(value);
  } catch (error) {
    fail("INVALID_RANDOM_VALUE", `${field} must be an unsigned 64-bit integer.`, { field }, error);
  }

  if (parsed < 0n || parsed > MASK_64) {
    fail("INVALID_RANDOM_VALUE", `${field} must be an unsigned 64-bit integer.`, { field });
  }
  return parsed;
}

function rotateRight32(value: number, rotation: number): number {
  return ((value >>> rotation) | (value << ((32 - rotation) & 31))) >>> 0;
}

function advance(state: bigint, increment: bigint): bigint {
  return (state * MULTIPLIER + increment) & MASK_64;
}

export class Pcg32Random implements RandomSource {
  readonly algorithm = "pcg32-v1";
  readonly state: bigint;
  readonly increment: bigint;

  constructor(state: bigint, increment: bigint) {
    this.state = state & MASK_64;
    this.increment = increment & MASK_64;
    Object.freeze(this);
  }

  nextUint32(): RandomStep {
    const nextState = advance(this.state, this.increment);
    const xorshifted = Number((((this.state >> 18n) ^ this.state) >> 27n) & 0xffff_ffffn);
    const rotation = Number(this.state >> 59n);
    return Object.freeze({
      value: rotateRight32(xorshifted, rotation),
      next: new Pcg32Random(nextState, this.increment),
    });
  }
}

export function createSeededRandom(options: {
  readonly seed: bigint | string;
  readonly stream?: bigint | string;
}): RandomSource {
  const seed = parseUnsigned64(options.seed, "seed");
  const stream = parseUnsigned64(options.stream ?? 1n, "stream");
  const increment = ((stream << 1n) | 1n) & MASK_64;
  const firstState = advance(0n, increment);
  const seededState = (firstState + seed) & MASK_64;
  return new Pcg32Random(advance(seededState, increment), increment);
}

export function serializePcg32(source: RandomSource): JsonObject | undefined {
  if (!(source instanceof Pcg32Random)) {
    return undefined;
  }
  return Object.freeze({
    algorithm: source.algorithm,
    state: source.state.toString(),
    increment: source.increment.toString(),
  });
}

export function restorePcg32(value: JsonObject): RandomSource {
  if (
    value.algorithm !== "pcg32-v1" ||
    typeof value.state !== "string" ||
    typeof value.increment !== "string"
  ) {
    fail("INVALID_SERIALIZED_DATA", "Invalid serialized PCG32 state.");
  }
  return new Pcg32Random(
    parseUnsigned64(value.state, "state"),
    parseUnsigned64(value.increment, "increment"),
  );
}
