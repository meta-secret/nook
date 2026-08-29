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
  assert.equal(isolationForFixProfile(profile), AgentIsolation.Strict);
  assert.equal(
    isolationForFixProfile(resolveCiAgentFixProfile()),
    AgentIsolation.Legacy,
  );
  assert.throws(
    () => resolveCiAgentFixProfile("rust-dependency-update-typo"),
    /Unsupported CI_AGENT_FIX_PROFILE/,
  );
});

test("dependency validation runs fixed commands in order with exact overrides", async () => {
  const calls: Array<[string, readonly string[], NodeJS.ProcessEnv]> = [];
  const secrets = {
    CURSOR_API_KEY: "cursor-secret",
    NOOK_GITHUB_PAT: "github-secret",
    GITHUB_TOKEN: "github-token",
  };
  const baseEnvironment = { HOME: "/home/runner", PATH: "/bin" };
  await runRustDependencyUpdateValidation(
    "/repo",
    {
      ...baseEnvironment,
      ...secrets,
      WASM_BUILD_MODE: "wrong-host-value",
    },
    async (command, args, { env }) => void calls.push([command, args, env]),
  );

  assert.deepEqual(
    calls.map(([command, args]) => [command, ...args]),
    [
      ["task", "ci:pr:e2e"],
      ["task", "docker:ecosystem:fuzz", "FUZZ_SECONDS=20"],
      ["task", "hive:verify"],
    ],
  );
  assert.deepEqual(
    calls.map(([, , env]) => env),
    [
      {
        ...baseEnvironment,
        WASM_BUILD_MODE: "prod",
        VITE_BASE: "/",
        VITE_VAULT_SYNC_INTERVAL_MS: "1000",
      },
      baseEnvironment,
      baseEnvironment,
    ],
  );
  for (const [, , env] of calls)
    for (const secret of Object.keys(secrets))
      assert.equal(secret in env, false);
});

test("publication credentials are absent during validation and restored after", async () => {
  const hostEnvironment: NodeJS.ProcessEnv = {
    PATH: "/bin",
    CURSOR_API_KEY: "cursor",
    NOOK_GITHUB_PAT: "github",
  };
  const original = { ...hostEnvironment };
  await withValidationEnvironment(hostEnvironment, async (environment) => {
    assert.deepEqual(environment, { PATH: "/bin" });
  });
  assert.deepEqual(hostEnvironment, original);
});

test("validation failure prevents publication", async () => {
  let published = false;
  await assert.rejects(
    validateThenPublish(
      async () => {
        throw new Error("validation failed");
      },
      async () => {
        published = true;
      },
    ),
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
  for (const [field, value, message] of [
    ["currentHeadSha", "c".repeat(40), /baseline HEAD/],
    ["currentIndexTreeSha", "d".repeat(40), /baseline index/],
  ] as const)
    assert.throws(
      () =>
        assertRepositoryBaselineUnchanged({
          baseline,
          currentHeadSha: baseline.headSha,
          currentIndexTreeSha: baseline.indexTreeSha,
          [field]: value,
        }),
      message,
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

    for (const [path, message] of [
      ["README.md", /forbidden path/],
      ["nook-app/nook-platform/Taskfile.yml", /orchestration control/],
      ["nook-app/nook-platform/build.rs", /orchestration control/],
    ] as const)
      await assert.rejects(
        assertRustDependencyUpdateChangeSet(root, [{ path, status: " M" }]),
        message,
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
  for (const entry of [
    {
      key: "http.https://github.com/.extraheader",
      value: "AUTHORIZATION: basic should-not-appear",
    },
    { key: "credential.https://github.com.helper", value: "store" },
  ])
    assert.throws(
      () => assertNoPersistedGitCredentials([entry]),
      (error) => {
        assert.match(String(error), /credential detected/);
        assert.doesNotMatch(String(error), /should-not-appear/);
        return true;
      },
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

test("new publication exact identity succeeds and mismatches fail closed", () => {
  assert.equal(assertPublishedFixIdentity(PUBLISHED_IDENTITY), "a".repeat(40));
  const mismatches = [
    { actualPrNumber: 1209 },
    { actualHeadRef: "fix/other" },
    { actualHeadSha: "b".repeat(40) },
    { actualRemoteHeadSha: "b".repeat(40) },
    { actualBaseRef: "release" },
  ] as const;
  for (const mismatch of mismatches)
    assert.throws(
      () => assertPublishedFixIdentity({ ...PUBLISHED_IDENTITY, ...mismatch }),
      /Published (?:PR|remote branch)/,
    );
});

test("existing PR verification binds PR and remote branch identity", async () => {
  const headSha = "a".repeat(40);
  const verify = (remoteHeadSha: string) =>
    verifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: "fix/rust-dependencies-42",
      expectedPrNumber: 1208,
      fetchPullRequest: async () => ({
        base: { ref: "main" },
        head: { ref: "fix/rust-dependencies-42", sha: headSha },
        number: 1208,
      }),
      fetchRemoteHeadSha: async () => remoteHeadSha,
    });
  assert.equal(await verify(headSha), headSha);
  await assert.rejects(verify("b".repeat(40)), /head SHA changed/);
});
