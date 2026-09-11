import assert from "node:assert/strict";
import type { Result } from "neverthrow";
import type { CiFailure } from "../main/failure.js";

export class CiResultAssertions {
  private constructor() {}
  static assertSuccess<T>(outcome: Result<T, CiFailure>): T {
    assert.ok(
      outcome.isOk(),
      outcome.isErr() ? outcome.error.message : "expected success",
    );
    return outcome.value;
  }
  static assertFailure(
    outcome: Result<unknown, CiFailure>,
    expected: RegExp | ((failure: CiFailure) => boolean),
  ): void {
    assert.ok(outcome.isErr(), "expected explicit failure");
    if (expected instanceof RegExp)
      assert.match(outcome.error.message, expected);
    else assert.ok(expected(outcome.error));
  }
  static async assertAsyncFailure(
    outcome: Promise<Result<unknown, CiFailure>>,
    expected: RegExp | ((failure: CiFailure) => boolean),
  ): Promise<void> {
    CiResultAssertions.assertFailure(await outcome, expected);
  }
}
