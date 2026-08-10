import { describe, expect, it } from "vitest";

import { deriveCardInstance, normalizeConfig, type NormalizedConfig } from "../src/config.js";
import { ProbaDeckError } from "../src/errors.js";
import { binomial, combinations } from "../src/math/combinatorics.js";
import {
  addFractions,
  complementFraction,
  divideFractions,
  fraction,
  fractionsEqual,
  fractionToNumber,
  multiplyFractions,
  subtractFractions,
  sumFractions,
} from "../src/math/fraction.js";
import {
  addInstance,
  createInstanceRegistry,
  requireInstance,
  type InstanceRegistry,
} from "../src/model/instances.js";
import {
  resolvePlacement,
  resolvePlacementChoices,
  resolveRange,
} from "../src/operations/positions.js";
import { instanceMatchesTarget, validateTarget } from "../src/probability/targets.js";
import {
  createSeededRandom,
  Pcg32Random,
  restorePcg32,
  serializePcg32,
} from "../src/random/pcg32.js";
import { requireRandom, sampleBounded, shuffleValues } from "../src/random/sampling.js";
import type { CardTarget, RandomSource } from "../src/types.js";

function tape(words: readonly number[], index = 0): RandomSource {
  return {
    algorithm: "tape",
    nextUint32: () => {
      const value = words[index];
      if (value === undefined) {
        throw new Error("Tape exhausted.");
      }
      return { value, next: tape(words, index + 1) };
    },
  };
}

describe("exact arithmetic and combinatorics", () => {
  it("normalizes and combines signed fractions", () => {
    const half = fraction(-2n, -4n);
    const negative = fraction(2, -3);
    expect(half).toEqual({ numerator: 1n, denominator: 2n });
    expect(negative).toEqual({ numerator: -2n, denominator: 3n });
    expect(fraction(0, -2)).toEqual({ numerator: 0n, denominator: 1n });
    expect(addFractions(half, negative)).toEqual({ numerator: -1n, denominator: 6n });
    expect(subtractFractions(half, negative)).toEqual({ numerator: 7n, denominator: 6n });
    expect(multiplyFractions(half, negative)).toEqual({ numerator: -1n, denominator: 3n });
    expect(divideFractions(half, negative)).toEqual({ numerator: -3n, denominator: 4n });
    expect(complementFraction(half)).toEqual(half);
    expect(fractionsEqual(half, fraction(1, 2))).toBe(true);
    expect(fractionsEqual(half, fraction(2, 3))).toBe(false);
    expect(fractionToNumber(fraction(1, 4))).toBe(0.25);
    expect(sumFractions([half, half])).toEqual({ numerator: 1n, denominator: 1n });
    expect(() => fraction(1, 0)).toThrowError(RangeError);
    expect(() => divideFractions(half, fraction(0))).toThrowError(RangeError);
  });

  it("handles valid, symmetric, and invalid combinations", () => {
    expect(binomial(5, 2)).toBe(10n);
    expect(binomial(5, 3)).toBe(10n);
    expect(binomial(-1, 0)).toBe(0n);
    expect(binomial(2, 3)).toBe(0n);
    expect(() => binomial(1.5, 1)).toThrowError(RangeError);
    expect(() => binomial(1, 0.5)).toThrowError(RangeError);
    expect(combinations(["a", "b", "c"], 2)).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
    expect(combinations([1], 0)).toEqual([[]]);
    expect(combinations([1], -1)).toEqual([]);
    expect(combinations([1], 2)).toEqual([]);
    expect(combinations([1], 0.5)).toEqual([]);
  });
});

describe("configuration and instances", () => {
  it("normalizes classifier names and values", () => {
    const normalized = normalizeConfig({
      cardKey: (card: string) => card,
      classifiers: {
        zeta: () => ["z", "a", "z"],
        alpha: () => "one",
      },
    });
    const instance = deriveCardInstance("id", "key", normalized);
    expect(normalized.classifierNames).toEqual(["alpha", "zeta"]);
    expect(instance.classifiers).toEqual({ alpha: ["one"], zeta: ["a", "z"] });
  });

  it("rejects invalid configuration callbacks and metadata", () => {
    // @ts-expect-error Runtime validation intentionally receives malformed input.
    expect(() => normalizeConfig({})).toThrowError(ProbaDeckError);
    // @ts-expect-error Runtime validation intentionally receives malformed input.
    expect(() => normalizeConfig(null)).toThrowError(ProbaDeckError);
    // @ts-expect-error Runtime validation intentionally receives malformed input.
    expect(() => normalizeConfig({ cardKey: () => "x", classifiers: null })).toThrowError(
      ProbaDeckError,
    );
    // @ts-expect-error Runtime validation intentionally receives malformed input.
    expect(() => normalizeConfig({ cardKey: () => "x", classifiers: { bad: 1 } })).toThrowError(
      ProbaDeckError,
    );
    expect(() =>
      normalizeConfig({ cardKey: () => "x", classifiers: { "": () => "x" } }),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      deriveCardInstance("id", "x", normalizeConfig({ cardKey: () => "" })),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      deriveCardInstance(
        "id",
        "x",
        normalizeConfig({
          cardKey: () => {
            throw new Error("bad");
          },
        }),
      ),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      deriveCardInstance(
        "id",
        "x",
        normalizeConfig({ classifiers: { group: () => "" }, cardKey: () => "x" }),
      ),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      deriveCardInstance(
        "id",
        "x",
        normalizeConfig({
          classifiers: {
            group: () => {
              throw new Error("bad");
            },
          },
          cardKey: () => "x",
        }),
      ),
    ).toThrowError(ProbaDeckError);
    const broken: NormalizedConfig<string> = {
      cardKey: (card) => card,
      classifiers: {},
      classifierNames: ["missing"],
    };
    expect(() => deriveCardInstance("id", "x", broken)).toThrowError(Error);
  });

  it("validates explicit, generated, duplicate, and missing instance IDs", () => {
    const normalized = normalizeConfig({ cardKey: (card: string) => card });
    expect(() => createInstanceRegistry(["a"], [], normalized)).toThrowError(ProbaDeckError);
    expect(() => createInstanceRegistry(["a"], [""], normalized)).toThrowError(ProbaDeckError);
    const initial = createInstanceRegistry(["a"], undefined, normalized);
    expect(requireInstance(initial.instances, "instance-1").card).toBe("a");
    expect(() => requireInstance(initial.instances, "missing")).toThrowError(ProbaDeckError);
    expect(() => addInstance(initial, "duplicate", "instance-1", normalized)).toThrowError(
      ProbaDeckError,
    );
    const skippedRegistry: InstanceRegistry<string> = {
      instances: initial.instances,
      nextInstanceNumber: 1,
    };
    const skipped = addInstance(skippedRegistry, "b", undefined, normalized);
    expect([...skipped.instances.keys()]).toEqual(["instance-1", "instance-2"]);
  });
});

describe("positions, randomness, and targets", () => {
  it("resolves every placement form and bounds policy", () => {
    expect(resolveRange(undefined, 3)).toMatchObject({
      range: { startIndex: 0, endIndexExclusive: 3 },
      wasClamped: false,
    });
    expect(resolveRange({ startIndex: -1, endIndexExclusive: 9 }, 3, "clamp")).toMatchObject({
      range: { startIndex: 0, endIndexExclusive: 3 },
      wasClamped: true,
    });
    expect(resolveRange({ startIndex: 0, endIndexExclusive: 9 }, 3, "clamp").wasClamped).toBe(true);
    expect(resolveRange({ startIndex: -1, endIndexExclusive: 3 }, 3, "clamp").wasClamped).toBe(
      true,
    );
    expect(() => resolveRange({ startIndex: 2, endIndexExclusive: 1 }, 3)).toThrowError(
      ProbaDeckError,
    );
    expect(() => resolveRange({ startIndex: Number.NaN, endIndexExclusive: 1 }, 3)).toThrowError(
      ProbaDeckError,
    );
    expect(resolvePlacementChoices({ kind: "from-top", offset: 1 }, 3).gaps).toEqual([1]);
    expect(resolvePlacementChoices({ kind: "from-bottom", offset: 0 }, 3).gaps).toEqual([3]);
    expect(resolvePlacementChoices({ kind: "index", index: 2 }, 3).gaps).toEqual([2]);
    expect(
      resolvePlacementChoices({ kind: "random-within", startGap: -1, endGap: 9 }, 3, "clamp"),
    ).toMatchObject({ gaps: [0, 1, 2, 3], wasClamped: true });
    expect(() =>
      resolvePlacementChoices({ kind: "random-within", startGap: 2, endGap: 1 }, 3),
    ).toThrowError(ProbaDeckError);
    expect(resolvePlacement({ kind: "index", index: 1 }, 3, "error", undefined)).toMatchObject({
      gap: 1,
      decision: undefined,
    });
    expect(() =>
      resolvePlacement({ kind: "random-within", startGap: 0, endGap: 2 }, 3, "error", undefined),
    ).toThrowError(ProbaDeckError);
  });

  it("locks PCG serialization and rejection sampling behavior", () => {
    let random = createSeededRandom({ seed: "42", stream: "54" });
    const expected = [2707161783, 2068313097, 3122475824];
    const actual = expected.map(() => {
      const step = random.nextUint32();
      random = step.next;
      return step.value;
    });
    expect(actual).toEqual(expected);
    const serialized = serializePcg32(random);
    expect(serialized).toBeDefined();
    if (serialized === undefined) {
      throw new Error("Expected serialized PCG state.");
    }
    expect(restorePcg32(serialized).nextUint32()).toEqual(random.nextUint32());
    expect(
      serializePcg32({ algorithm: "custom", nextUint32: () => random.nextUint32() }),
    ).toBeUndefined();
    expect(() => restorePcg32({ algorithm: "wrong", state: "0", increment: "1" })).toThrowError(
      ProbaDeckError,
    );
    expect(() => createSeededRandom({ seed: "bad" })).toThrowError(ProbaDeckError);
    expect(() => createSeededRandom({ seed: -1n })).toThrowError(ProbaDeckError);
    expect(() => createSeededRandom({ seed: 1n << 64n })).toThrowError(ProbaDeckError);
    expect(new Pcg32Random(-1n, -1n).state).toBe((1n << 64n) - 1n);

    expect(sampleBounded(tape([0, 4]), 3).decision.words).toEqual([0, 4]);
    expect(
      resolvePlacement({ kind: "random-within", startGap: 0, endGap: 2 }, 3, "error", tape([2])),
    ).toMatchObject({
      gap: 2,
      decision: { value: 2 },
    });
    expect(shuffleValues([1, 2, 3], tape([2, 1])).values).toEqual([1, 2, 3]);
    expect(shuffleValues([], tape([])).values).toEqual([]);
    expect(requireRandom(tape([1]))).toBeDefined();
    expect(() => requireRandom(undefined)).toThrowError(ProbaDeckError);
    for (const bound of [0, -1, 1.5, 0x1_0000_0001]) {
      expect(() => sampleBounded(tape([1]), bound)).toThrowError(ProbaDeckError);
    }
    for (const badWord of [-1, 1.5, 0x1_0000_0000]) {
      expect(() => sampleBounded(tape([badWord]), 2)).toThrowError(ProbaDeckError);
    }
  });

  it("validates and evaluates every target expression", () => {
    const normalized = normalizeConfig({
      cardKey: (card: string) => card,
      classifiers: { color: () => "red" },
    });
    const instance = deriveCardInstance("id", "key", normalized);
    const instances = new Map([[instance.instanceId, instance]]);
    const targets: readonly CardTarget[] = [
      { kind: "instance", instanceId: "id" },
      { kind: "card-key", cardKey: "key" },
      { kind: "classifier", classifier: "color", value: "red" },
      { kind: "not", target: { kind: "card-key", cardKey: "other" } },
      {
        kind: "all",
        targets: [
          { kind: "card-key", cardKey: "key" },
          { kind: "classifier", classifier: "color", value: "red" },
        ],
      },
      {
        kind: "any",
        targets: [
          { kind: "card-key", cardKey: "other" },
          { kind: "instance", instanceId: "id" },
        ],
      },
    ];
    for (const value of targets) {
      validateTarget(value, normalized, instances);
      expect(instanceMatchesTarget(instance, value)).toBe(true);
    }
    expect(
      instanceMatchesTarget(instance, { kind: "classifier", classifier: "missing", value: "x" }),
    ).toBe(false);
    expect(
      instanceMatchesTarget(instance, {
        kind: "all",
        targets: [{ kind: "card-key", cardKey: "other" }],
      }),
    ).toBe(false);
    expect(
      instanceMatchesTarget(instance, {
        kind: "any",
        targets: [{ kind: "card-key", cardKey: "other" }],
      }),
    ).toBe(false);
    expect(() =>
      validateTarget({ kind: "instance", instanceId: "missing" }, normalized, instances),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      validateTarget({ kind: "card-key", cardKey: "" }, normalized, instances),
    ).toThrowError(ProbaDeckError);
    expect(() =>
      validateTarget(
        { kind: "classifier", classifier: "missing", value: "x" },
        normalized,
        instances,
      ),
    ).toThrowError(ProbaDeckError);
    expect(() => validateTarget({ kind: "all", targets: [] }, normalized, instances)).toThrowError(
      ProbaDeckError,
    );
    expect(() => validateTarget({ kind: "any", targets: [] }, normalized, instances)).toThrowError(
      ProbaDeckError,
    );
    // @ts-expect-error Runtime validation intentionally receives a malformed target.
    expect(() => validateTarget(null, normalized, instances)).toThrowError(ProbaDeckError);
    // @ts-expect-error Runtime validation intentionally receives an unknown target kind.
    expect(() => validateTarget({ kind: "unknown" }, normalized, instances)).toThrowError(
      ProbaDeckError,
    );
    const cyclic: { kind: "not"; target?: CardTarget } = { kind: "not" };
    // @ts-expect-error Runtime validation intentionally receives a cyclic target.
    cyclic.target = cyclic;
    // @ts-expect-error Runtime validation intentionally receives a cyclic target.
    expect(() => validateTarget(cyclic, normalized, instances)).toThrowError(ProbaDeckError);
  });

  it("keeps structured error details and optional causes", () => {
    const plain = new ProbaDeckError("INVALID_CONFIG", "plain");
    const cause = new Error("cause");
    const wrapped = new ProbaDeckError("INVALID_CONFIG", "wrapped", { field: "x" }, cause);
    expect(plain.details).toEqual({});
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.name).toBe("ProbaDeckError");
  });
});
