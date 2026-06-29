import assert from "node:assert/strict";
import test from "node:test";

import { AgentTextLog, ShellStreamLog } from "../dist/interaction-log.js";

function captureLog() {
  const lines: string[] = [];
  const writer = { log: (line = "") => lines.push(line) };
  return { lines, writer };
}

test("AgentTextLog opens a block and indents streamed lines", () => {
  const { lines, writer } = captureLog();
  const log = new AgentTextLog(writer);

  log.write("The run may still");
  log.write(" be finishing;\nI'll check");
  log.write(" the logs.");
  log.closeBlock();

  assert.deepEqual(lines, [
    "",
    "==> agent",
    "    The run may still be finishing;",
    "    I'll check the logs.",
  ]);
});

test("AgentTextLog closes an in-progress line before the next block", () => {
  const { lines, writer } = captureLog();
  const log = new AgentTextLog(writer);

  log.write("partial");
  log.closeBlock();
  log.write("next message");
  log.closeBlock();

  assert.deepEqual(lines, [
    "",
    "==> agent",
    "    partial",
    "",
    "==> agent",
    "    next message",
  ]);
});

test("ShellStreamLog prefixes live shell output", () => {
  const { lines, writer } = captureLog();
  const log = new ShellStreamLog(writer);

  log.openBlock();
  log.write("task: ci:verify\nerror: failed");
  log.closeBlock();

  assert.deepEqual(lines, [
    "--- output ---",
    "    | task: ci:verify",
    "    | error: failed",
  ]);
  assert.equal(log.hasStreamed(), true);
});
