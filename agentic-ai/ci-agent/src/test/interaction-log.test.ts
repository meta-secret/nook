import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentTextLog,
  ShellStreamLog,
  StreamEvidence,
  type LogWriter,
} from "../main/interaction-log.js";

class InteractionLogTestFixture {
  readonly lines: string[] = [];
  readonly streamed: { text: string } = { text: "" };
  readonly writer: LogWriter = {
    log: (line = "") => this.lines.push(line),
    write: (chunk) => {
      this.streamed.text += chunk;
    },
  };

  assertLogLines(component: string, message: string, count = 1): void {
    assert.equal(this.lines.length, count);
    for (const line of this.lines) {
      assert.match(
        line,
        new RegExp(
          `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2},\\d{3} INFO  \\[${component}\\] ${message}$`,
        ),
      );
    }
  }
}

void test("AgentTextLog opens a block and streams agent text incrementally", () => {
  const fixture = new InteractionLogTestFixture();
  let log = new AgentTextLog(fixture.writer);

  log = log.write("The run may still");
  log = log.write(" be finishing;\nI'll check");
  log = log.write(" the logs.");
  log = log.closeBlock();

  fixture.assertLogLines("ci-agent/cursor/agent", "agent output");
  assert.equal(
    fixture.streamed.text,
    "    The run may still be finishing;\n    I'll check the logs.\n",
  );
});

void test("AgentTextLog closes an in-progress line before the next block", () => {
  const fixture = new InteractionLogTestFixture();
  let log = new AgentTextLog(fixture.writer);

  log = log.write("partial");
  log = log.closeBlock();
  log = log.write("next message");
  log = log.closeBlock();

  fixture.assertLogLines("ci-agent/cursor/agent", "agent output", 2);
  assert.equal(fixture.streamed.text, "    partial\n    next message\n");
});

void test("ShellStreamLog prefixes live shell output", () => {
  const fixture = new InteractionLogTestFixture();
  let log = new ShellStreamLog(fixture.writer);

  log = log.openBlock();
  log = log.write("task: ci:verify\nerror: failed");
  log = log.closeBlock();

  fixture.assertLogLines("ci-agent/cursor/shell", "output");
  assert.equal(
    fixture.streamed.text,
    "    | task: ci:verify\n    | error: failed\n",
  );
  assert.equal(log.observation(), StreamEvidence.Seen);
});

void test("ShellStreamLog streams partial shell output before newline", () => {
  const fixture = new InteractionLogTestFixture();
  let log = new ShellStreamLog(fixture.writer);

  log = log.openBlock();
  log = log.write("running");
  log = log.write(" tests");
  log = log.closeBlock();

  fixture.assertLogLines("ci-agent/cursor/shell", "output");
  assert.equal(fixture.streamed.text, "    | running tests\n");
});
