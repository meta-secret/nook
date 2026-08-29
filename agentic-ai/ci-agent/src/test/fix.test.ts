import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertNoPersistedGitCredentials,
  assertPublishedFixIdentity,
  assertRepositoryBaselineUnchanged,
  assertRustDependencyUpdateChangeSet,
  CiAgentFixProfile,
  createValidationEnvironment,
  isolationForFixProfile,
  resolveCiAgentFixProfile,
  runValidationCommand,
  runRustDependencyUpdateValidation,
  validateThenPublish,
  verifyPublishedFix,
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

test("streamed validation runner propagates exit and signal failures", async () => {
  const options = { cwd: process.cwd(), env: process.env };
  await assert.rejects(
    runValidationCommand(process.execPath, ["-e", "process.exit(7)"], options),
    /exited with code 7/,
  );
  await assert.rejects(
    runValidationCommand(
      process.execPath,
      ["-e", "process.kill(process.pid, 'SIGTERM')"],
      options,
    ),
    /terminated by signal SIGTERM/,
  );
});

test("baseline HEAD and index mutations fail closed", () => {
  const baseline = {
    headSha: "a".repeat(40),
    indexTreeSha: "b".repeat(40),
  };
  assert.doesNotThrow(() =>
    assertRepositoryBaselineUnchanged({
      baseline,
      currentHeadSha: baseline.headSha,
      currentIndexTreeSha: baseline.indexTreeSha,
    }),
  );
  assert.throws(
    () =>
      assertRepositoryBaselineUnchanged({
        baseline,
        currentHeadSha: "c".repeat(40),
        currentIndexTreeSha: baseline.indexTreeSha,
      }),
    /baseline HEAD/,
  );
  assert.throws(
    () =>
      assertRepositoryBaselineUnchanged({
        baseline,
        currentHeadSha: baseline.headSha,
        currentIndexTreeSha: "d".repeat(40),
      }),
    /baseline index/,
  );
});

test("dependency update scope accepts only regular Rust mission files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nook-fix-scope-"));
  try {
    const allowed = [
      "nook-app/nook-platform/Cargo.toml",
      "nook-app/nook-platform/fuzz/Cargo.lock",
      "agentic-ai/minds/hive/src/lib.rs",
      "preflight/tests/policy.rs",
    ];
    for (const path of allowed) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), "trusted change\n");
    }
    await assertRustDependencyUpdateChangeSet(
      root,
      allowed.map((path) => ({ path, status: " M" })),
    );

    await assert.rejects(
      assertRustDependencyUpdateChangeSet(root, [
        { path: "README.md", status: " M" },
      ]),
      /forbidden path/,
    );

    const taskfile = "nook-app/nook-platform/Taskfile.yml";
    await writeFile(join(root, taskfile), "version: '3'\n");
    await assert.rejects(
      assertRustDependencyUpdateChangeSet(root, [
        { path: taskfile, status: " M" },
      ]),
      /orchestration control/,
    );

    const buildScript = "nook-app/nook-platform/build.rs";
    await writeFile(join(root, buildScript), "fn main() {}\n");
    await assert.rejects(
      assertRustDependencyUpdateChangeSet(root, [
        { path: buildScript, status: " M" },
      ]),
      /orchestration control/,
    );

    const symlinkPath = "preflight/src/linked.rs";
    await mkdir(join(root, "preflight/src"), { recursive: true });
    await symlink(join(root, allowed[3]!), join(root, symlinkPath));
    await assert.rejects(
      assertRustDependencyUpdateChangeSet(root, [
        { path: symlinkPath, status: "??" },
      ]),
      /symlink or special file/,
    );

    await assert.rejects(
      assertRustDependencyUpdateChangeSet(
        root,
        [{ path: "preflight/src/deleted.rs", status: " D" }],
        async () => "120000",
      ),
      /deleted a symlink or special file/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted Git authentication config fails without exposing values", () => {
  assert.doesNotThrow(() =>
    assertNoPersistedGitCredentials([
      { key: "core.repositoryformatversion", value: "0" },
    ]),
  );
  assert.throws(
    () =>
      assertNoPersistedGitCredentials([
        {
          key: "http.https://github.com/.extraheader",
          value: "AUTHORIZATION: basic should-not-appear",
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /credential detected/);
      assert.doesNotMatch(error.message, /should-not-appear/);
      return true;
    },
  );
  assert.throws(
    () =>
      assertNoPersistedGitCredentials([
        { key: "credential.https://github.com.helper", value: "store" },
      ]),
    /credential detected/,
  );
});

const PUBLISHED_IDENTITY = {
  actualBaseRef: "main",
  actualHeadRef: "fix/rust-dependencies-42",
  actualHeadSha: "a".repeat(40),
  actualPrNumber: 1208,
  actualRemoteHeadSha: "a".repeat(40),
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
    ["remote branch SHA", { actualRemoteHeadSha: "b".repeat(40) }],
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
        /Published (?:PR|remote branch)/,
      );
    });
  }
});

test("existing PR verification binds PR and remote branch identity", async () => {
  const headSha = "a".repeat(40);
  assert.equal(
    await verifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: "fix/rust-dependencies-42",
      expectedPrNumber: 1208,
      fetchPullRequest: async () => ({
        base: { ref: "main" },
        head: { ref: "fix/rust-dependencies-42", sha: headSha },
        number: 1208,
      }),
      fetchRemoteHeadSha: async () => headSha,
    }),
    headSha,
  );
  await assert.rejects(
    verifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: "fix/rust-dependencies-42",
      expectedPrNumber: 1208,
      fetchPullRequest: async () => ({
        base: { ref: "main" },
        head: { ref: "fix/rust-dependencies-42", sha: headSha },
        number: 1208,
      }),
      fetchRemoteHeadSha: async () => "b".repeat(40),
    }),
    /head SHA changed/,
  );
});
