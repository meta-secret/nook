import assert from "node:assert/strict";
import test from "node:test";

import { formatLogLine, formatLogTimestamp } from "../main/logger.js";

test("formatLogTimestamp uses log4j-style UTC timestamps", () => {
  const ts = formatLogTimestamp(new Date("2026-06-29T20:14:32.879Z"));
  assert.equal(ts, "2026-06-29 20:14:32,879");
});

test("formatLogLine includes level and component", () => {
  const line = formatLogLine(
    "INFO",
    "ci-agent/agent-wait",
    "Agent still running (20m 0s)",
    new Date("2026-06-29T20:14:32.879Z"),
  );
  assert.equal(
    line,
    "2026-06-29 20:14:32,879 INFO  [ci-agent/agent-wait] Agent still running (20m 0s)",
  );
});
