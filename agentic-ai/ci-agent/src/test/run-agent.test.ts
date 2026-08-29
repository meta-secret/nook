import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAgentEnvironment } from "../main/run-agent.js";

test("agent subprocess environment retains only non-credential execution settings", () => {
  const environment = {
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-secret",
    ACTIONS_RUNTIME_TOKEN: "runtime-secret",
    CURSOR_API_KEY: "cursor-secret",
    HOME: "/tmp/home",
    NOOK_GITHUB_PAT: "github-secret",
    PATH: "/usr/bin",
    WASM_BUILD_MODE: "prod",
  };

  sanitizeAgentEnvironment(environment);

  assert.deepEqual(environment, {
    HOME: "/tmp/home",
    PATH: "/usr/bin",
    WASM_BUILD_MODE: "prod",
  });
});
