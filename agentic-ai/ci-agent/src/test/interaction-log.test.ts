import assert from "node:assert/strict";
import test from "node:test";

import { AgentTextLog, ShellStreamLog, type LogWriter } from "../main/interaction-log.js";

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

function assertLogLines(lines: string[], component: string, message: string, count = 1): void {
  assert.equal(lines.length, count);
  for (const line of lines) {
    assert.match(
      line,
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2},\\d{3} INFO  \\[${component}\\] ${message}$`,
      ),
    );
  }
}

test("AgentTextLog opens a block and streams agent text incrementally", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new AgentTextLog(writer);

  log.write("The run may still");
  log.write(" be finishing;\nI'll check");
  log.write(" the logs.");
  log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/agent", "agent output");
  assert.equal(streamed.text, "    The run may still be finishing;\n    I'll check the logs.\n");
});

test("AgentTextLog closes an in-progress line before the next block", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new AgentTextLog(writer);

  log.write("partial");
  log.closeBlock();
  log.write("next message");
  log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/agent", "agent output", 2);
  assert.equal(streamed.text, "    partial\n    next message\n");
});

test("ShellStreamLog prefixes live shell output", () => {
  const { lines, streamed, writer } = captureLog();
  const log = new ShellStreamLog(writer);

  log.openBlock();
  log.write("task: ci:verify\nerror: failed");
  log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/shell", "output");
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

  assertLogLines(lines, "ci-agent/cursor/shell", "output");
  assert.equal(streamed.text, "    | running tests\n");
});
