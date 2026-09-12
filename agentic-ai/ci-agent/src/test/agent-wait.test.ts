import { CiResultAssertions } from "./result-assertions.js";
import { ok } from "neverthrow";
import assert from "node:assert/strict";
import test from "node:test";

import { ElapsedDuration, AgentWait } from "../main/agent-wait.js";
import { CiFailureKind } from "../main/failure.js";

void test("formatDuration renders human-readable durations", () => {
  assert.equal(new ElapsedDuration(45_000).format(), "45s");
  assert.equal(new ElapsedDuration(125_000).format(), "2m 5s");
  assert.equal(new ElapsedDuration(3_725_000).format(), "1h 2m 5s");
});

void test("waitWithHeartbeat resolves when work completes", async () => {
  const result = await new AgentWait({
    label: "Test",
    wait: async () => ok("done"),
    options: { timeoutMs: 5_000, heartbeatMs: 60_000 },
  })
    .complete()
    .then(CiResultAssertions.assertSuccess);
  assert.equal(result, "done");
});

void test("waitWithHeartbeat rejects on timeout", async () => {
  await CiResultAssertions.assertAsyncFailure(
    new AgentWait({
      label: "Test",
      wait: () => new Promise<never>(() => {}),
      options: { timeoutMs: 50, heartbeatMs: 60_000 },
    }).complete(),
    /timed out/,
  );
});

void test("waitWithHeartbeat returns rejected work as a typed failure", async () => {
  await CiResultAssertions.assertAsyncFailure(
    new AgentWait({
      label: "Test",
      wait: async () => Promise.reject(new Error("private agent failure")),
      options: { timeoutMs: 60_000, heartbeatMs: 60_000 },
    }).complete(),
    (failure) =>
      failure.kind === CiFailureKind.Agent &&
      failure.message === "Test failed before returning a typed outcome",
  );
});
