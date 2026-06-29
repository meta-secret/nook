import assert from "node:assert/strict";
import test from "node:test";

import type { ToolCall } from "@cursor/sdk";

import {
  extractShellOutputChunk,
  formatToolCompleted,
  formatToolStarted,
} from "../dist/tool-summary.js";

test("formatToolStarted shortens CI workspace paths", () => {
  const toolCall = {
    type: "read",
    args: { path: "/home/runner/work/nook/nook/.cortex/AGENTS.md" },
  } satisfies ToolCall;

  assert.equal(formatToolStarted(toolCall), "read .cortex/AGENTS.md");
});

test("formatToolStarted summarizes shell commands", () => {
  const toolCall = {
    type: "shell",
    args: {
      command: "gh run view 28353869812 --log-failed 2>&1 | tail -200",
      workingDirectory: "/home/runner/work/nook/nook",
      timeout: 30_000,
    },
  } satisfies ToolCall;

  assert.equal(
    formatToolStarted(toolCall),
    "shell gh run view 28353869812 --log-failed 2>&1 | tail -200",
  );
});

test("formatToolCompleted includes shell stdout and stderr", () => {
  const toolCall = {
    type: "shell",
    args: { command: "task ci:main:parallel" },
    result: {
      status: "success",
      value: {
        exitCode: 1,
        signal: "",
        stdout: "task: ci:verify:parallel\nerror: test failed",
        stderr: "warning: slow step",
        executionTime: 42,
      },
    },
  } satisfies ToolCall;

  assert.deepEqual(formatToolCompleted(toolCall), [
    "--- stdout ---",
    "    task: ci:verify:parallel",
    "    error: test failed",
    "--- stderr ---",
    "    warning: slow step",
    "shell exit 1",
  ]);
});

test("formatToolCompleted reports shell exit codes without empty output blocks", () => {
  const success = {
    type: "shell",
    args: { command: "true" },
    result: {
      status: "success",
      value: {
        exitCode: 0,
        signal: "",
        stdout: "",
        stderr: "",
        executionTime: 1,
      },
    },
  } satisfies ToolCall;

  assert.deepEqual(formatToolCompleted(success), ["shell exit 0"]);
});

test("formatToolCompleted skips noisy read completions", () => {
  const toolCall = {
    type: "read",
    args: { path: ".cortex/AGENTS.md" },
    result: {
      status: "success",
      value: { content: "# Nook", fileSize: 6, totalLines: 1 },
    },
  } satisfies ToolCall;

  assert.equal(formatToolCompleted(toolCall), null);
});

test("formatToolCompleted surfaces tool errors", () => {
  const toolCall = {
    type: "shell",
    args: { command: "missing-cmd" },
    result: {
      status: "error",
      error: { message: "command not found" },
    },
  } satisfies ToolCall;

  assert.deepEqual(formatToolCompleted(toolCall), ["shell failed: command not found"]);
});

test("extractShellOutputChunk reads common event shapes", () => {
  assert.equal(extractShellOutputChunk({ text: "line 1\n" }), "line 1\n");
  assert.equal(extractShellOutputChunk({ case: "stdout", value: { content: "ok" } }), "ok");
  assert.equal(extractShellOutputChunk(undefined), "");
});
