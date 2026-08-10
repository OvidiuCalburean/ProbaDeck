import type { JsonObject } from "./types.js";

export type ProbaDeckErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_CARD_METADATA"
  | "DUPLICATE_INSTANCE_ID"
  | "UNKNOWN_INSTANCE"
  | "INSTANCE_NOT_DRAWN"
  | "INVALID_TARGET"
  | "UNKNOWN_CLASSIFIER"
  | "INVALID_POSITION"
  | "POSITION_OUT_OF_BOUNDS"
  | "INVALID_REGION"
  | "INVALID_COUNT"
  | "EMPTY_DECK"
  | "RANDOM_SOURCE_REQUIRED"
  | "INVALID_RANDOM_VALUE"
  | "INFERENCE_LIMIT_EXCEEDED"
  | "IMPOSSIBLE_OBSERVATION"
  | "INVALID_SERIALIZED_DATA"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "CARD_METADATA_MISMATCH"
  | "REPLAY_DIVERGENCE";

export class ProbaDeckError extends Error {
  readonly code: ProbaDeckErrorCode;
  readonly details: JsonObject;

  constructor(
    code: ProbaDeckErrorCode,
    message: string,
    details: JsonObject = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProbaDeckError";
    this.code = code;
    this.details = details;
  }
}

export function fail(
  code: ProbaDeckErrorCode,
  message: string,
  details: JsonObject = {},
  cause?: unknown,
): never {
  throw new ProbaDeckError(code, message, details, cause);
}
