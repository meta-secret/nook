import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  assertGitMetadataBaselineUnchanged,
  assertNoPersistedGitCredentials,
  assertPublishedFixIdentity,
  assertRepositoryBaselineUnchanged,
  assertRustDependencyUpdateChangeSet,
  CI_FIX_SKIPPED,
  CiFixOutcomeKind,
  isolationForFixProfile,
  resolveCiAgentFixProfile,
  runRustDependencyUpdateValidation,
  verifyPublishedFix,
  withValidationEnvironment,
} from "../main/fix.js";
import type { CiFixOutcome } from "../main/fix.js";
import { AgentIsolation } from "../main/run-agent.js";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const execFileAsync = promisify(execFile);

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
  const calls: unknown[] = [];
  await runRustDependencyUpdateValidation(
    "/repo",
    {
      PATH: "/bin",
      CURSOR_API_KEY: "cursor-secret",
      NOOK_GITHUB_PAT: "github-secret",
      GITHUB_TOKEN: "github-token",
      WASM_BUILD_MODE: "wrong-host-value",
    },
    async (command, args, { env }) => void calls.push([command, ...args, env]),
  );
  assert.deepEqual(calls, [
    [
      "task",
      "ci:pr:e2e",
      {
        PATH: "/bin",
        WASM_BUILD_MODE: "prod",
        VITE_BASE: "/",
        VITE_VAULT_SYNC_INTERVAL_MS: "1000",
      },
    ],
    ["task", "docker:ecosystem:fuzz", "FUZZ_SECONDS=20", { PATH: "/bin" }],
    ["task", "hive:verify", { PATH: "/bin" }],
  ]);
});

test("validation strips secrets and forces Docker workloads offline", async () => {
  const root = await mkdtemp(join(tmpdir(), "nook-validation-test-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  await mkdir(bin);
  const realDocker = join(bin, "docker");
  await writeFile(realDocker, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`);
  await chmod(realDocker, 0o700);
  const hostEnvironment: NodeJS.ProcessEnv = {
    PATH: bin,
    HOME: "/trusted/home",
    CURSOR_API_KEY: "cursor",
    NOOK_GITHUB_PAT: "github",
    SCCACHE_S3_ACCESS_KEY_FILE: "/trusted/sccache-access",
  };
  try {
    await withValidationEnvironment(hostEnvironment, async (environment) => {
      for (const secret of [
        "CURSOR_API_KEY",
        "NOOK_GITHUB_PAT",
        "SCCACHE_S3_ACCESS_KEY_FILE",
      ])
        assert.equal(secret in environment, false);
      assert.notEqual(environment.HOME, "/trusted/home");
      await execFileAsync("docker", ["buildx", "build", "."], {
        env: environment,
      });
      await execFileAsync("docker", ["run", "image"], { env: environment });
      await assert.rejects(
        execFileAsync("docker", ["exec", "container", "cargo", "test"], {
          env: environment,
        }),
        /Blocked Docker operation/,
      );
    });
    assert.equal(
      await readFile(log, "utf8"),
      "buildx build --network none .\nrun --network none image\n",
    );
    assert.deepEqual(hostEnvironment, {
      PATH: bin,
      HOME: "/trusted/home",
      CURSOR_API_KEY: "cursor",
      NOOK_GITHUB_PAT: "github",
      SCCACHE_S3_ACCESS_KEY_FILE: "/trusted/sccache-access",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline Git state mutations fail closed", () => {
  const baseline = { headSha: SHA, indexTreeSha: OTHER_SHA };
  for (const current of [
    { currentHeadSha: OTHER_SHA, currentIndexTreeSha: baseline.indexTreeSha },
    { currentHeadSha: baseline.headSha, currentIndexTreeSha: SHA },
  ])
    assert.throws(
      () => assertRepositoryBaselineUnchanged({ baseline, ...current }),
      /baseline (?:HEAD|index)/,
    );
  const gitMetadata = {
    commonDirectory: "/repo/.git",
    configuration: "global\0file:/trusted\0user.name\ntrusted\0",
    gitDirectory: "/repo/.git",
  };
  for (const current of [
    { ...gitMetadata, commonDirectory: "/repo/attacker.git" },
    { ...gitMetadata, gitDirectory: "/repo/attacker.git" },
    {
      ...gitMetadata,
      configuration: `${gitMetadata.configuration}local\0file:.git/config\0core.hookspath\nattacker-hooks\0`,
    },
  ])
    assert.throws(
      () =>
        assertGitMetadataBaselineUnchanged({ baseline: gitMetadata, current }),
      /changed trusted Git metadata/,
    );
});

test("dependency update scope accepts only regular Rust mission files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nook-fix-scope-"));
  try {
    const allowed = [
      "nook-app/nook-platform/Cargo.toml",
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
    const rejects = (
      path: string,
      status: string,
      message: RegExp,
      lookup = async () => "",
    ) =>
      assert.rejects(
        assertRustDependencyUpdateChangeSet(root, [{ path, status }], lookup),
        message,
      );

    for (const [path, message] of [
      ["README.md", /forbidden path/],
      ["nook-app/nook-platform/Taskfile.yml", /orchestration control/],
      ["nook-app/nook-platform/build.rs", /orchestration control/],
    ] as const)
      await rejects(path, " M", message);

    const symlinkPath = "preflight/src/linked.rs";
    await mkdir(join(root, "preflight/src"), { recursive: true });
    await symlink(join(root, allowed[2]!), join(root, symlinkPath));
    await rejects(symlinkPath, "??", /symlink or special file/);
    await rejects(
      "preflight/src/deleted.rs",
      " D",
      /deleted a symlink or special file/,
      async () => "120000",
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
  actualHeadSha: SHA,
  actualPrNumber: 1208,
  actualRemoteHeadSha: SHA,
  expectedBaseRef: "main",
  expectedHeadRef: "fix/rust-dependencies-42",
  expectedHeadSha: SHA,
  expectedPrNumber: 1208,
};

test("publication outcomes and exact identity fail closed", async () => {
  const published: CiFixOutcome = {
    headSha: SHA,
    kind: CiFixOutcomeKind.Published,
  };
  assert.deepEqual(
    [CI_FIX_SKIPPED.kind, published.kind],
    [CiFixOutcomeKind.Skipped, CiFixOutcomeKind.Published],
  );
  assert.equal(assertPublishedFixIdentity(PUBLISHED_IDENTITY), SHA);
  const mismatches = [
    { actualPrNumber: 1209 },
    { actualHeadRef: "fix/other" },
    { actualHeadSha: OTHER_SHA },
    { actualRemoteHeadSha: OTHER_SHA },
    { actualBaseRef: "release" },
  ] as const;
  for (const mismatch of mismatches)
    assert.throws(
      () => assertPublishedFixIdentity({ ...PUBLISHED_IDENTITY, ...mismatch }),
      /Published (?:PR|remote branch)/,
    );
  const verify = (remoteHeadSha: string) =>
    verifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: "fix/rust-dependencies-42",
      expectedPrNumber: 1208,
      fetchPullRequest: async () => ({
        base: { ref: "main" },
        head: { ref: "fix/rust-dependencies-42", sha: SHA },
        number: 1208,
      }),
      fetchRemoteHeadSha: async () => remoteHeadSha,
    });
  assert.equal(await verify(SHA), SHA);
  await assert.rejects(verify(OTHER_SHA), /head SHA changed/);
});
