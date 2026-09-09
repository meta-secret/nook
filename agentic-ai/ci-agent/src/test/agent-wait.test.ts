import assert from "node:assert/strict";
import test from "node:test";

import { ElapsedDuration, AgentWait } from "../main/agent-wait.js";

test("formatDuration renders human-readable durations", () => {
  assert.equal(new ElapsedDuration(45_000).format(), "45s");
  assert.equal(new ElapsedDuration(125_000).format(), "2m 5s");
  assert.equal(new ElapsedDuration(3_725_000).format(), "1h 2m 5s");
});

test("waitWithHeartbeat resolves when work completes", async () => {
  const result = await new AgentWait({
    label: "Test",
    wait: async () => "done",
    options: { timeoutMs: 5_000, heartbeatMs: 60_000 },
  }).complete();
  assert.equal(result, "done");
});

test("waitWithHeartbeat rejects on timeout", async () => {
  await assert.rejects(
    new AgentWait({
      label: "Test",
      wait: () => new Promise(() => {}),
      options: { timeoutMs: 50, heartbeatMs: 60_000 },
    }).complete(),
    /timed out/,
  );
});
