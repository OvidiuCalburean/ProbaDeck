import { deriveCardInstance, type NormalizedConfig } from "../config.js";
import { fail } from "../errors.js";
import type { CardInstance } from "../types.js";

export interface InstanceRegistry<TCard> {
  readonly instances: ReadonlyMap<string, CardInstance<TCard>>;
  readonly nextInstanceNumber: number;
}

function validateExplicitId(instanceId: string): void {
  if (typeof instanceId !== "string" || instanceId.length === 0) {
    fail("INVALID_CARD_METADATA", "Instance IDs must be non-empty strings.");
  }
}

function nextGeneratedId(instances: ReadonlyMap<string, unknown>, start: number): [string, number] {
  let next = start;
  let instanceId = `instance-${next}`;

  while (instances.has(instanceId)) {
    next += 1;
    instanceId = `instance-${next}`;
  }

  return [instanceId, next + 1];
}

export function createInstanceRegistry<TCard>(
  cards: readonly TCard[],
  instanceIds: readonly string[] | undefined,
  config: NormalizedConfig<TCard>,
): InstanceRegistry<TCard> {
  if (instanceIds !== undefined && instanceIds.length !== cards.length) {
    fail("INVALID_CARD_METADATA", "instanceIds must have the same length as cards.", {
      cards: cards.length,
      instanceIds: instanceIds.length,
    });
  }

  let registry: InstanceRegistry<TCard> = {
    instances: new Map(),
    nextInstanceNumber: 1,
  };

  cards.forEach((card, index) => {
    registry = addInstance(registry, card, instanceIds?.[index], config);
  });

  return registry;
}

export function addInstance<TCard>(
  registry: InstanceRegistry<TCard>,
  card: TCard,
  explicitId: string | undefined,
  config: NormalizedConfig<TCard>,
): InstanceRegistry<TCard> {
  let instanceId: string;
  let nextInstanceNumber = registry.nextInstanceNumber;

  if (explicitId === undefined) {
    [instanceId, nextInstanceNumber] = nextGeneratedId(registry.instances, nextInstanceNumber);
  } else {
    validateExplicitId(explicitId);
    instanceId = explicitId;
  }

  if (registry.instances.has(instanceId)) {
    fail("DUPLICATE_INSTANCE_ID", `Instance ID '${instanceId}' is already registered.`, {
      instanceId,
    });
  }

  const instances = new Map(registry.instances);
  instances.set(instanceId, deriveCardInstance(instanceId, card, config));

  return Object.freeze({ instances, nextInstanceNumber });
}

export function requireInstance<TCard>(
  instances: ReadonlyMap<string, CardInstance<TCard>>,
  instanceId: string,
): CardInstance<TCard> {
  const instance = instances.get(instanceId);
  if (instance === undefined) {
    fail("UNKNOWN_INSTANCE", `Unknown instance ID '${instanceId}'.`, { instanceId });
  }
  return instance;
}
