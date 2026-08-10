import type { NormalizedConfig } from "../config.js";
import { fail } from "../errors.js";
import type { CardInstance, CardTarget } from "../types.js";

function validateNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_TARGET", `${field} must be a non-empty string.`, { field });
  }
}

export function validateTarget<TCard>(
  target: CardTarget,
  config: NormalizedConfig<TCard>,
  instances: ReadonlyMap<string, CardInstance<TCard>>,
  ancestors: ReadonlySet<object> = new Set(),
): void {
  if (typeof target !== "object" || target === null) {
    fail("INVALID_TARGET", "A target must be an object.");
  }
  if (ancestors.has(target)) {
    fail("INVALID_TARGET", "Target expressions cannot contain cycles.");
  }

  if (target.kind === "instance") {
    validateNonEmpty(target.instanceId, "instanceId");
    if (!instances.has(target.instanceId)) {
      fail("UNKNOWN_INSTANCE", `Unknown target instance '${target.instanceId}'.`, {
        instanceId: target.instanceId,
      });
    }
    return;
  }
  if (target.kind === "card-key") {
    validateNonEmpty(target.cardKey, "cardKey");
    return;
  }
  if (target.kind === "classifier") {
    validateNonEmpty(target.classifier, "classifier");
    validateNonEmpty(target.value, "value");
    if (!config.classifierNames.includes(target.classifier)) {
      fail("UNKNOWN_CLASSIFIER", `Unknown classifier '${target.classifier}'.`, {
        classifier: target.classifier,
      });
    }
    return;
  }
  if (target.kind === "not") {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(target);
    validateTarget(target.target, config, instances, nextAncestors);
    return;
  }
  if (target.kind === "all" || target.kind === "any") {
    if (!Array.isArray(target.targets) || target.targets.length === 0) {
      fail("INVALID_TARGET", `${target.kind} targets must contain at least one child.`);
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(target);
    for (const child of target.targets) {
      validateTarget(child, config, instances, nextAncestors);
    }
    return;
  }

  fail("INVALID_TARGET", "Unknown target kind.");
}

export function instanceMatchesTarget<TCard>(
  instance: CardInstance<TCard>,
  target: CardTarget,
): boolean {
  if (target.kind === "instance") {
    return instance.instanceId === target.instanceId;
  }
  if (target.kind === "card-key") {
    return instance.cardKey === target.cardKey;
  }
  if (target.kind === "classifier") {
    return instance.classifiers[target.classifier]?.includes(target.value) ?? false;
  }
  if (target.kind === "not") {
    return !instanceMatchesTarget(instance, target.target);
  }
  if (target.kind === "all") {
    return target.targets.every((child) => instanceMatchesTarget(instance, child));
  }
  return target.targets.some((child) => instanceMatchesTarget(instance, child));
}
