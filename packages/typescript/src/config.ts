import { fail } from "./errors.js";
import type { CardInstance, Classifier, DeckConfig } from "./types.js";

export interface NormalizedConfig<TCard> {
  readonly cardKey: (card: TCard) => string;
  readonly classifiers: Readonly<Record<string, Classifier<TCard>>>;
  readonly classifierNames: readonly string[];
}

function sortStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const insertionIndex = result.findIndex((existing) => value.localeCompare(existing) < 0);
    result.splice(insertionIndex === -1 ? result.length : insertionIndex, 0, value);
  }
  return result;
}

function normalizeClassifierNames<TCard>(
  classifiers: Readonly<Record<string, Classifier<TCard>>> | undefined,
): readonly string[] {
  const names = sortStrings(Object.keys(classifiers ?? {}));

  for (const name of names) {
    if (name.length === 0) {
      fail("INVALID_CONFIG", "Classifier names cannot be empty.");
    }
  }

  return Object.freeze(names);
}

export function normalizeConfig<TCard>(config: DeckConfig<TCard>): NormalizedConfig<TCard> {
  if (typeof config !== "object" || config === null || typeof config.cardKey !== "function") {
    fail("INVALID_CONFIG", "A cardKey function is required.");
  }

  if (
    config.classifiers !== undefined &&
    (typeof config.classifiers !== "object" || config.classifiers === null)
  ) {
    fail("INVALID_CONFIG", "Classifiers must be a record of functions.");
  }

  const names = normalizeClassifierNames(config.classifiers);
  const classifiers: Record<string, Classifier<TCard>> = {};

  for (const name of names) {
    const classifier = config.classifiers?.[name];
    if (typeof classifier !== "function") {
      fail("INVALID_CONFIG", `Classifier '${name}' must be a function.`, { classifier: name });
    }
    classifiers[name] = classifier;
  }

  return Object.freeze({
    cardKey: config.cardKey,
    classifiers: Object.freeze(classifiers),
    classifierNames: names,
  });
}

function normalizeClassifierValue(
  classifier: string,
  value: string | readonly string[],
): readonly string[] {
  const values: readonly unknown[] = typeof value === "string" ? [value] : value;
  const normalized: string[] = [];

  for (const entry of values) {
    if (typeof entry !== "string" || entry.length === 0) {
      fail(
        "INVALID_CARD_METADATA",
        `Classifier '${classifier}' must return a non-empty string or an array of non-empty strings.`,
        { classifier },
      );
    }
    if (!normalized.includes(entry)) {
      normalized.push(entry);
    }
  }

  return Object.freeze(sortStrings(normalized));
}

export function deriveCardInstance<TCard>(
  instanceId: string,
  card: TCard,
  config: NormalizedConfig<TCard>,
): CardInstance<TCard> {
  let cardKey: string;

  try {
    cardKey = config.cardKey(card);
  } catch (error) {
    fail("INVALID_CARD_METADATA", "The cardKey function threw an error.", { instanceId }, error);
  }

  if (typeof cardKey !== "string" || cardKey.length === 0) {
    fail("INVALID_CARD_METADATA", "cardKey must return a non-empty string.", { instanceId });
  }

  const classifiers: Record<string, readonly string[]> = {};
  for (const name of config.classifierNames) {
    const classifier = config.classifiers[name];
    if (classifier === undefined) {
      throw new Error(`Normalized configuration is missing classifier '${name}'.`);
    }
    let rawValue: string | readonly string[];
    try {
      rawValue = classifier(card);
    } catch (error) {
      fail(
        "INVALID_CARD_METADATA",
        `Classifier '${name}' threw an error.`,
        { classifier: name, instanceId },
        error,
      );
    }
    classifiers[name] = normalizeClassifierValue(name, rawValue);
  }

  return Object.freeze({
    instanceId,
    card,
    cardKey,
    classifiers: Object.freeze(classifiers),
  });
}
