import assert from "node:assert/strict";
import test from "node:test";

import type { ToolCall } from "@cursor/sdk";

import { formatToolCompleted, formatToolStarted } from "./tool-summary.js";

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

test("formatToolCompleted reports shell exit codes", () => {
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

  const failure = {
    type: "shell",
    args: { command: "false" },
    result: {
      status: "success",
      value: {
        exitCode: 1,
        signal: "",
        stdout: "",
        stderr: "boom",
        executionTime: 1,
      },
    },
  } satisfies ToolCall;

  assert.equal(formatToolCompleted(success), "shell exit 0");
  assert.equal(formatToolCompleted(failure), "shell exit 1");
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

  assert.equal(formatToolCompleted(toolCall), "shell failed: command not found");
});
