import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  resolveAgentTask,
  resolveMajorChangeAuthorization,
} from "../main/prompt.js";

const ENV_KEYS = [
  "AGENT_PROMPT",
  "MAJOR_CHANGE_AUTHORIZED",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("resolveMajorChangeAuthorization", () => {
  it("defaults to not authorized", () => {
    assert.equal(resolveMajorChangeAuthorization(), "not-authorized");
  });

  it("accepts only the exact trusted workflow value", () => {
    process.env.MAJOR_CHANGE_AUTHORIZED = "true";
    assert.equal(resolveMajorChangeAuthorization(), "authorized");

    process.env.MAJOR_CHANGE_AUTHORIZED = "TRUE";
    assert.equal(resolveMajorChangeAuthorization(), "not-authorized");
  });
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
