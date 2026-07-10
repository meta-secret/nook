import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeCommitSubject } from "../main/git.js";
import { shouldSkipIssueAgent } from "../main/github.js";

test("shouldSkipIssueAgent matches no-agent and skip-agent labels", () => {
  assert.equal(shouldSkipIssueAgent(["bug", "no-agent"]), true);
  assert.equal(shouldSkipIssueAgent(["Skip-Agent"]), true);
  assert.equal(shouldSkipIssueAgent(["bug", "enhancement"]), false);
  assert.equal(shouldSkipIssueAgent([]), false);
});

test("sanitizeCommitSubject collapses whitespace and truncates", () => {
  assert.equal(
    sanitizeCommitSubject("Implement #12:  Fix   the thing\nplease"),
    "Implement #12: Fix the thing please",
  );
  const long = `Implement #99: ${"x".repeat(100)}`;
  const subject = sanitizeCommitSubject(long);
  assert.ok(subject.length <= 72);
  assert.ok(subject.endsWith("..."));
});
