import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPublishedFixIdentity,
  CiAgentFixProfile,
  createValidationEnvironment,
  isolationForFixProfile,
  resolveCiAgentFixProfile,
  runRustDependencyUpdateValidation,
  validateThenPublish,
  withValidationEnvironment,
} from "../main/fix.js";
import { AgentIsolation } from "../main/run-agent.js";

test("rust dependency update profile selects strict isolation", () => {
  const profile = resolveCiAgentFixProfile("rust-dependency-update");
  assert.equal(profile, CiAgentFixProfile.RustDependencyUpdate);
  assert.equal(isolationForFixProfile(profile), AgentIsolation.Strict);
  assert.equal(
    isolationForFixProfile(resolveCiAgentFixProfile(undefined)),
    AgentIsolation.Legacy,
  );
  assert.throws(
    () => resolveCiAgentFixProfile("rust-dependency-update-typo"),
    /Unsupported CI_AGENT_FIX_PROFILE/,
  );
});

test("dependency validation runs fixed commands in order with exact overrides", async () => {
  const calls: Array<{
    command: string;
    args: readonly string[];
    environment: NodeJS.ProcessEnv;
  }> = [];
  await runRustDependencyUpdateValidation(
    "/repo",
    {
      PATH: "/bin",
      HOME: "/home/runner",
      CURSOR_API_KEY: "cursor-secret",
      NOOK_GITHUB_PAT: "github-secret",
      GITHUB_TOKEN: "github-token",
      WASM_BUILD_MODE: "wrong-host-value",
    },
    async (command, args, options) => {
      calls.push({ command, args, environment: options.env });
    },
  );

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      ["task", "ci:pr:e2e"],
      ["task", "docker:ecosystem:fuzz", "FUZZ_SECONDS=20"],
      ["task", "hive:verify"],
    ],
  );
  assert.deepEqual(
    {
      WASM_BUILD_MODE: calls[0]?.environment.WASM_BUILD_MODE,
      VITE_BASE: calls[0]?.environment.VITE_BASE,
      VITE_VAULT_SYNC_INTERVAL_MS:
        calls[0]?.environment.VITE_VAULT_SYNC_INTERVAL_MS,
    },
    {
      WASM_BUILD_MODE: "prod",
      VITE_BASE: "/",
      VITE_VAULT_SYNC_INTERVAL_MS: "1000",
    },
  );
  assert.equal(calls[1]?.environment.WASM_BUILD_MODE, undefined);
  assert.equal(calls[2]?.environment.VITE_BASE, undefined);
  for (const call of calls) {
    assert.equal(call.environment.CURSOR_API_KEY, undefined);
    assert.equal(call.environment.NOOK_GITHUB_PAT, undefined);
    assert.equal(call.environment.GITHUB_TOKEN, undefined);
    assert.equal(call.environment.PATH, "/bin");
    assert.equal(call.environment.HOME, "/home/runner");
  }
});

test("validation environment excludes publication credentials", () => {
  const environment = createValidationEnvironment({
    PATH: "/bin",
    DOCKER_HOST: "unix:///docker.sock",
    CURSOR_API_KEY: "cursor-secret",
    NOOK_GITHUB_PAT: "github-secret",
    GH_TOKEN: "gh-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
  });
  assert.deepEqual(environment, {
    PATH: "/bin",
    DOCKER_HOST: "unix:///docker.sock",
  });
});

test("publication credentials are absent during validation and restored after", async () => {
  const hostEnvironment: NodeJS.ProcessEnv = {
    PATH: "/bin",
    CURSOR_API_KEY: "cursor-secret",
    NOOK_GITHUB_PAT: "github-secret",
    GITHUB_TOKEN: "github-token",
  };
  await withValidationEnvironment(hostEnvironment, async (environment) => {
    assert.equal(environment.CURSOR_API_KEY, undefined);
    assert.equal(environment.NOOK_GITHUB_PAT, undefined);
    assert.equal(environment.GITHUB_TOKEN, undefined);
    assert.equal(environment.PATH, "/bin");
  });
  assert.deepEqual(hostEnvironment, {
    PATH: "/bin",
    CURSOR_API_KEY: "cursor-secret",
    NOOK_GITHUB_PAT: "github-secret",
    GITHUB_TOKEN: "github-token",
  });
});

test("validation failure prevents publication", async () => {
  let published = false;
  await assert.rejects(
    validateThenPublish({
      validate: async () => {
        throw new Error("validation failed");
      },
      publish: async () => {
        published = true;
      },
    }),
    /validation failed/,
  );
  assert.equal(published, false);
});

const PUBLISHED_IDENTITY = {
  actualBaseRef: "main",
  actualHeadRef: "fix/rust-dependencies-42",
  actualHeadSha: "a".repeat(40),
  actualPrNumber: 1208,
  expectedBaseRef: "main",
  expectedHeadRef: "fix/rust-dependencies-42",
  expectedHeadSha: "a".repeat(40),
  expectedPrNumber: 1208,
};

test("exact published fix identity returns the verified head", () => {
  assert.equal(
    assertPublishedFixIdentity(PUBLISHED_IDENTITY),
    PUBLISHED_IDENTITY.expectedHeadSha,
  );
});

test("published fix identity mismatches fail closed", async (t) => {
  const mismatches = [
    ["PR number", { actualPrNumber: 1209 }],
    ["head branch", { actualHeadRef: "fix/other" }],
    ["head SHA", { actualHeadSha: "b".repeat(40) }],
    ["base branch", { actualBaseRef: "release" }],
  ] as const;
  for (const [name, mismatch] of mismatches) {
    await t.test(name, () => {
      assert.throws(
        () =>
          assertPublishedFixIdentity({
            ...PUBLISHED_IDENTITY,
            ...mismatch,
          }),
        /Published PR/,
      );
    });
  }
});
