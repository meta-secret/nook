import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveAgentTask } from "../main/prompt.js";

const ENV_KEYS = [
  "AGENT_PROMPT",
  "AGENT_ISSUE_NUMBER",
  "AGENT_ISSUE_TITLE",
  "AGENT_ISSUE_BODY",
  "AGENT_ISSUE_URL",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("resolveAgentTask", () => {
  it("prefers AGENT_PROMPT when set", () => {
    process.env.AGENT_PROMPT = "  Ship the feature  ";
    process.env.AGENT_ISSUE_NUMBER = "42";
    assert.equal(resolveAgentTask(), "Ship the feature");
  });

  it("builds a task from issue env vars", () => {
    process.env.AGENT_ISSUE_NUMBER = "12";
    process.env.AGENT_ISSUE_TITLE = "Add agent workflow";
    process.env.AGENT_ISSUE_BODY = "Implement the labeled-issue path.";
    process.env.AGENT_ISSUE_URL = "https://github.com/meta-secret/nook/issues/12";

    assert.equal(
      resolveAgentTask(),
      [
        "GitHub issue #12: Add agent workflow",
        "URL: https://github.com/meta-secret/nook/issues/12",
        "",
        "Implement the labeled-issue path.",
      ].join("\n"),
    );
  });

  it("throws when neither prompt nor issue fields are set", () => {
    assert.throws(() => resolveAgentTask(), /AGENT_PROMPT or AGENT_ISSUE/);
  });
});
