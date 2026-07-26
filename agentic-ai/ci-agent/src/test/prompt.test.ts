import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveAgentTask } from "../main/prompt.js";

const ENV_KEYS = [
  "AGENT_PROMPT",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("resolveAgentTask", () => {
  it("prefers AGENT_PROMPT when set", () => {
    process.env.AGENT_PROMPT = "  Ship the feature  ";
    assert.equal(resolveAgentTask(), "Ship the feature");
  });

  it("throws when the explicit prompt is missing", () => {
    assert.throws(() => resolveAgentTask(), /AGENT_PROMPT is required/);
  });
});
