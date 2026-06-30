import assert from "node:assert/strict";
import test from "node:test";

import { AgentTextLog, ShellStreamLog, type LogWriter } from "../main/interaction-log.js";
import { formatLogLine } from "../main/logger.js";

function captureLog() {
  const lines: string[] = [];
  const streamed: { text: string } = { text: "" };
  const writer: LogWriter = {
    log: (line = "") => lines.push(line),
    write: (chunk) => {
      streamed.text += chunk;
    },
  };
  return { lines, streamed, writer };
}

test("AgentTextLog opens a block and streams agent text incrementally", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new AgentTextLog(writer);

  log.write("The run may still");
  log.write(" be finishing;\nI'll check");
  log.write(" the logs.");
  log.closeBlock();

  assert.deepEqual(lines, [
    formatLogLine("INFO", "ci-agent/cursor/agent", "agent output"),
  ]);
  assert.equal(streamed.text, "    The run may still be finishing;\n    I'll check the logs.\n");
});

test("AgentTextLog closes an in-progress line before the next block", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new AgentTextLog(writer);

  log.write("partial");
  log.closeBlock();
  log.write("next message");
  log.closeBlock();

  assert.deepEqual(lines, [
    formatLogLine("INFO", "ci-agent/cursor/agent", "agent output"),
    formatLogLine("INFO", "ci-agent/cursor/agent", "agent output"),
  ]);
  assert.equal(streamed.text, "    partial\n    next message\n");
});

test("ShellStreamLog prefixes live shell output", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new ShellStreamLog(writer);

  log.openBlock();
  log.write("task: ci:verify\nerror: failed");
  log.closeBlock();

  assert.deepEqual(lines, [formatLogLine("INFO", "ci-agent/cursor/shell", "output")]);
  assert.equal(streamed.text, "    | task: ci:verify\n    | error: failed\n");
  assert.equal(log.hasStreamed(), true);
});

test("ShellStreamLog streams partial shell output before newline", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new ShellStreamLog(writer);

  log.openBlock();
  log.write("running");
  log.write(" tests");
  log.closeBlock();

  assert.deepEqual(lines, [formatLogLine("INFO", "ci-agent/cursor/shell", "output")]);
  assert.equal(streamed.text, "    | running tests\n");
});
