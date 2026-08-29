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
import { join, resolve } from "node:path";
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

test("validation isolates secrets, preserves wrapper vars, and denies network overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "nook-validation-test-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const trustedHome = join(root, "home");
  const builder = "nook-builder";
  await mkdir(bin);
  const instances = join(trustedHome, ".docker", "buildx", "instances");
  await mkdir(instances, { recursive: true });
  await writeFile(join(instances, builder), "trusted-instance");
  const realDocker = join(bin, "docker");
  await writeFile(realDocker, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`);
  await chmod(realDocker, 0o700);
  const hostEnvironment: NodeJS.ProcessEnv = {
    PATH: bin,
    HOME: trustedHome,
    CURSOR_API_KEY: "cursor",
    NOOK_GITHUB_PAT: "github",
    SCCACHE_S3_ACCESS_KEY_FILE: "/trusted/sccache-access",
    NOOK_ARC_HIVE: "1",
    NOOK_BUILDKIT_REMOTE: "1",
    NOOK_PR_BUILDX_BUILDER: builder,
  };
  const originalEnvironment = { ...hostEnvironment };
  try {
    await withValidationEnvironment(hostEnvironment, async (environment) => {
      for (const secret of [
        "CURSOR_API_KEY",
        "NOOK_GITHUB_PAT",
        "SCCACHE_S3_ACCESS_KEY_FILE",
      ])
        assert.equal(secret in environment, false);
      assert.notEqual(environment.HOME, trustedHome);
      assert.equal(environment.NOOK_ARC_HIVE, "1");
      assert.equal(environment.NOOK_BUILDKIT_REMOTE, "1");
      assert.equal(
        await readFile(
          join(environment.HOME!, ".docker", "buildx", "instances", builder),
          "utf8",
        ),
        "trusted-instance",
      );
      const docker = (args: string[]) =>
        execFileAsync("docker", args, { env: environment });
      for (const args of [
        ["buildx", "build", "."],
        [
          "buildx",
          "create",
          "--name",
          builder,
          "--driver",
          "docker-container",
          "--bootstrap",
        ],
        ["buildx", "rm", "--force", builder],
        ["run", "image"],
      ])
        await docker(args);
      await assert.rejects(docker(["buildx", "rm", "--force", "other"]));
      for (const blocked of [
        ["run", "--network", "host", "image"],
        ["run", "--network=host", "image"],
      ])
        await assert.rejects(docker(blocked), /network override/);
      await assert.rejects(
        docker(["exec", "container", "cargo", "test"]),
        /Blocked Docker operation/,
      );
      const names: string[] = [];
      await runRustDependencyUpdateValidation(
        "/repo",
        environment,
        async (_command, args, { env }) => {
          names.push(String(args[0]));
          assert.equal(env.HOME, environment.HOME);
          assert.equal(
            env.NOOK_VALIDATION_DOCKER,
            environment.NOOK_VALIDATION_DOCKER,
          );
          assert.equal(env.SCCACHE_OPTIONAL, "1");
          if (args[0] === "ci:pr:e2e")
            assert.equal(env.WASM_BUILD_MODE, "prod");
          if (args[0] === "hive:verify") assert.equal(env.NOOK_ARC_HIVE, "1");
        },
      );
      assert.deepEqual(names, [
        "ci:pr:e2e",
        "docker:ecosystem:fuzz",
        "hive:verify",
      ]);
    });
    assert.equal(
      await readFile(log, "utf8"),
      `buildx build --network none .\nbuildx create --name ${builder} --driver docker-container --bootstrap\nbuildx rm --force ${builder}\nrun --network none image\n`,
    );
    assert.deepEqual(hostEnvironment, originalEnvironment);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("networked fetch steps materialize manifests before offline compilation", async () => {
  const repo = resolve(import.meta.dirname, "../../../..");
  for (const path of [
    "nook-app/nook-platform/docker/rust/product.Dockerfile",
    "preflight/Dockerfile",
    "agentic-ai/minds/hive/Dockerfile",
  ]) {
    const source = await readFile(join(repo, path), "utf8");
    const fetch = source.indexOf("RUN --network=default");
    const stage = source.slice(source.lastIndexOf("\nFROM ", fetch), fetch);
    const lines = source.slice(fetch).split("\n");
    let commandEnd = 0;
    while (lines[commandEnd]?.endsWith("\\")) commandEnd += 1;
    const command = lines.slice(0, commandEnd + 1).join("\n");
    assert.ok(
      fetch > 0 &&
        ["Cargo.toml", "Cargo.lock"].every((name) => stage.includes(name)),
    );
    const fetchInput = `${stage}\n${command}`;
    assert.match(fetchInput, /(?:touch|printf).*src/su);
    assert.doesNotMatch(stage, /^COPY .*src/mu);
    assert.doesNotMatch(fetchInput, /build\.rs|type=secret/u);
    assert.match(command, /cargo fetch --locked/u);
    assert.doesNotMatch(command, /cargo (?:build|test|chef|clippy)/u);
    assert.ok(fetch < source.indexOf("cargo chef cook", fetch));
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
    await writeFile(
      join(root, "nook-app/nook-platform/Cargo.toml"),
      'serde = { git = "https://evil.example/serde" }\n',
    );
    await rejects("nook-app/nook-platform/Cargo.toml", " M", /non-crates.io/);
    await writeFile(
      join(root, "nook-app/nook-platform/Cargo.lock"),
      'source = "git+https://evil.example/serde"\n',
    );
    await rejects(
      "nook-app/nook-platform/Cargo.lock",
      " M",
      /non-crates.io source/,
    );

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
  const verify = (remoteHeadSha: string, expectedHeadSha = SHA) =>
    verifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: "fix/rust-dependencies-42",
      expectedHeadSha,
      expectedPrNumber: 1208,
      fetchPullRequest: async () => ({
        base: { ref: "main" },
        head: { ref: "fix/rust-dependencies-42", sha: SHA },
        number: 1208,
      }),
      fetchRemoteHeadSha: async () => remoteHeadSha,
    });
  assert.equal(await verify(SHA), SHA);
  await assert.rejects(verify(OTHER_SHA), /remote branch SHA/);
  await assert.rejects(verify(SHA, OTHER_SHA), /PR head SHA/);
});
