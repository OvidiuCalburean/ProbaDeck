import type { ExactFraction } from "../types.js";

export const ZERO: ExactFraction = Object.freeze({ numerator: 0n, denominator: 1n });
export const ONE: ExactFraction = Object.freeze({ numerator: 1n, denominator: 1n });

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);

  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

export function fraction(
  numerator: bigint | number,
  denominator: bigint | number = 1n,
): ExactFraction {
  const rawNumerator = BigInt(numerator);
  const rawDenominator = BigInt(denominator);

  if (rawDenominator === 0n) {
    throw new RangeError("A fraction denominator cannot be zero.");
  }

  if (rawNumerator === 0n) {
    return ZERO;
  }

  const sign = rawDenominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(rawNumerator, rawDenominator);

  return Object.freeze({
    numerator: (rawNumerator / divisor) * sign,
    denominator: absolute(rawDenominator / divisor),
  });
}

export function addFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function subtractFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  return fraction(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiplyFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divideFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  if (right.numerator === 0n) {
    throw new RangeError("Cannot divide by a zero fraction.");
  }

  return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function complementFraction(value: ExactFraction): ExactFraction {
  return subtractFractions(ONE, value);
}

export function fractionsEqual(left: ExactFraction, right: ExactFraction): boolean {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}

export function fractionToNumber(value: ExactFraction): number {
  const scale = 1_000_000_000_000_000n;
  return Number((value.numerator * scale) / value.denominator) / Number(scale);
}

export function sumFractions(values: Iterable<ExactFraction>): ExactFraction {
  let result = ZERO;

  for (const value of values) {
    result = addFractions(result, value);
  }

  return result;
}
