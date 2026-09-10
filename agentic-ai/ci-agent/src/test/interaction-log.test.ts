import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentTextLog,
  ShellStreamLog,
  StreamEvidence,
  type LogWriter,
} from "../main/interaction-log.js";

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

function assertLogLines(
  lines: string[],
  component: string,
  message: string,
  count = 1,
): void {
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
  let log = new AgentTextLog(writer);

  log = log.write("The run may still");
  log = log.write(" be finishing;\nI'll check");
  log = log.write(" the logs.");
  log = log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/agent", "agent output");
  assert.equal(
    streamed.text,
    "    The run may still be finishing;\n    I'll check the logs.\n",
  );
});

test("AgentTextLog closes an in-progress line before the next block", () => {
  const { lines, streamed, writer } = captureLog();
  let log = new AgentTextLog(writer);

  log = log.write("partial");
  log = log.closeBlock();
  log = log.write("next message");
  log = log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/agent", "agent output", 2);
  assert.equal(streamed.text, "    partial\n    next message\n");
});

test("ShellStreamLog prefixes live shell output", () => {
  const { lines, streamed, writer } = captureLog();
  let log = new ShellStreamLog(writer);

  log = log.openBlock();
  log = log.write("task: ci:verify\nerror: failed");
  log = log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/shell", "output");
  assert.equal(streamed.text, "    | task: ci:verify\n    | error: failed\n");
  assert.equal(log.observation(), StreamEvidence.Seen);
});

test("ShellStreamLog streams partial shell output before newline", () => {
  const { lines, streamed, writer } = captureLog();
  let log = new ShellStreamLog(writer);

  log = log.openBlock();
  log = log.write("running");
  log = log.write(" tests");
  log = log.closeBlock();

  assertLogLines(lines, "ci-agent/cursor/shell", "output");
  assert.equal(streamed.text, "    | running tests\n");
});
