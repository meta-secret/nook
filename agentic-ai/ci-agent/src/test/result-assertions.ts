import assert from "node:assert/strict";
import type { Result } from "neverthrow";
import type { CiFailure } from "../main/failure.js";

export function assertSuccess<T>(outcome: Result<T, CiFailure>): T {
  assert.ok(
    outcome.isOk(),
    outcome.isErr() ? outcome.error.message : "expected success",
  );
  return outcome.value;
}
export function assertFailure(
  outcome: Result<unknown, CiFailure>,
  expected: RegExp | ((failure: CiFailure) => boolean),
): void {
  assert.ok(outcome.isErr(), "expected explicit failure");
  if (expected instanceof RegExp) assert.match(outcome.error.message, expected);
  else assert.ok(expected(outcome.error));
}
export async function assertAsyncFailure(
  outcome: Promise<Result<unknown, CiFailure>>,
  expected: RegExp | ((failure: CiFailure) => boolean),
): Promise<void> {
  assertFailure(await outcome, expected);
}
