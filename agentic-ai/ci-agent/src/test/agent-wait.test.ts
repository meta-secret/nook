import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, waitWithHeartbeat } from "../main/agent-wait.js";

test("formatDuration renders human-readable durations", () => {
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(3_725_000), "1h 2m 5s");
});

test("waitWithHeartbeat resolves when work completes", async () => {
  const result = await waitWithHeartbeat(
    "Test",
    async () => "done",
    { timeoutMs: 5_000, heartbeatMs: 60_000 },
  );
  assert.equal(result, "done");
});

test("waitWithHeartbeat rejects on timeout", async () => {
  await assert.rejects(
    waitWithHeartbeat(
      "Test",
      () => new Promise(() => {}),
      { timeoutMs: 50, heartbeatMs: 60_000 },
    ),
    /timed out/,
  );
});
