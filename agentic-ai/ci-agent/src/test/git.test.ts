import { CiResultAssertions } from "./result-assertions.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { CiRepository, AuthoredNumstat } from "../main/git.js";

const execFileAsync = promisify(execFile);

void describe("countAuthoredNumstat", () => {
  void it("counts only authored additions", () => {
    const numstat = "12\t3\tsrc/domain.ts\0" + "4\t5\ttests/domain.test.ts\0";
    assert.equal(new AuthoredNumstat(numstat).countAuthoredNumstat(), 16);
  });

  void it("reports generated, lock, snapshot, vendor, binary, and pure rename rows separately", () => {
    const numstat = [
      "8\t1\tsrc/domain.ts",
      "40\t20\tbun.lock",
      "12\t0\ttests/domain.snap",
      "31\t12\t",
      "tests/olé-old.snap",
      "tests/olé-new.snap",
      "15\t4\tvendor/library.ts",
      "10\t0\tgenerated/client.ts",
      "14\t2\tnook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts",
      "-\t-\tassets/demo.png",
      "0\t0\t",
      "src/old.ts",
      "src/new.ts",
      "",
    ].join("\0");
    assert.equal(new AuthoredNumstat(numstat).countAuthoredNumstat(), 8);
    const expectedReportedOnly = {
      binaryFiles: 1,
      generatedLines: 26,
      lockfileLines: 60,
      malformedRecords: 0,
      pureRenameFiles: 1,
      snapshotLines: 55,
      unmeasurableAuthoredFiles: 0,
      vendoredLines: 19,
    };
    assert.deepEqual(
      new AuthoredNumstat(numstat).summarizeAuthoredNumstat().reportedOnly,
      expectedReportedOnly,
    );
  });

  void it("does not treat source hidden by binary attributes as an excludable binary", () => {
    const numstat = "-\t-\tsrc/domain.ts\0";
    const summary = new AuthoredNumstat(numstat).summarizeAuthoredNumstat();
    assert.equal(summary.reportedOnly.binaryFiles, 0);
    assert.equal(summary.reportedOnly.unmeasurableAuthoredFiles, 1);
  });

  void it("fails closed when a binary source rename hides line counts", () => {
    const numstat = "-\t-\t\0src/old.ts\0src/new.ts\0";
    const summary = new AuthoredNumstat(numstat).summarizeAuthoredNumstat();
    assert.equal(summary.reportedOnly.pureRenameFiles, 0);
    assert.equal(summary.reportedOnly.unmeasurableAuthoredFiles, 1);
  });

  void it("reports a deleted binary source file without requiring an addition count", () => {
    const numstat = "-\t-\tsrc/obsolete.ts\0";
    const summary = new AuthoredNumstat(numstat).summarizeAuthoredNumstat({
      deletedPaths: new Set(["src/obsolete.ts"]),
    });
    assert.equal(summary.authoredLines, 0);
    assert.equal(summary.reportedOnly.binaryFiles, 1);
    assert.equal(summary.reportedOnly.unmeasurableAuthoredFiles, 0);
  });

  void it("skips malformed NUL-delimited records explicitly", () => {
    const numstat = "8\t1\tsrc/domain.ts\0malformed\0";
    assert.equal(new AuthoredNumstat(numstat).countAuthoredNumstat(), 8);
    assert.equal(
      new AuthoredNumstat(numstat).summarizeAuthoredNumstat().reportedOnly
        .malformedRecords,
      1,
    );
  });
});

void describe("implementation working tree", () => {
  void it("rejects non-canonical publication targets", async () => {
    const previousServerUrl = process.env.GITHUB_SERVER_URL;
    const previousRepository = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "meta-secret/nook";
    try {
      await new CiRepository("/not-a-repository")
        .pushFixBranch({
          fixBranch: "fix/dependency-update",
          remoteRef: "refs/heads/main",
          remoteUrl: "https://github.com/other/repository.git",
          runId: "42",
        })
        .then((result) =>
          CiResultAssertions.assertFailure(
            result,
            /canonical workflow target/u,
          ),
        );
    } finally {
      if (typeof previousServerUrl === "string")
        process.env.GITHUB_SERVER_URL = previousServerUrl;
      else delete process.env.GITHUB_SERVER_URL;
      if (typeof previousRepository === "string")
        process.env.GITHUB_REPOSITORY = previousRepository;
      else delete process.env.GITHUB_REPOSITORY;
    }
  });

  void it("marks the worktree safe before inspecting its state", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "nook-ci-agent-safe-"));
    const repoRoot = join(tempRoot, "repo");
    const globalConfig = join(tempRoot, "global.gitconfig");
    const hadGlobalConfig = Object.hasOwn(process.env, "GIT_CONFIG_GLOBAL");
    const [previousGlobalConfig = ""] = [process.env.GIT_CONFIG_GLOBAL];
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      await mkdir(repoRoot);
      await execFileAsync("git", ["-C", repoRoot, "init"]);
      await new CiRepository(repoRoot).configureGitForCi().then(CiResultAssertions.assertSuccess);
      await writeFile(join(repoRoot, "README.md"), "base\n");
      await execFileAsync("git", ["-C", repoRoot, "add", "README.md"]);
      await execFileAsync("git", ["-C", repoRoot, "commit", "-m", "base"]);
      const { stdout } = await execFileAsync("git", [
        "config",
        "--global",
        "--get-all",
        "safe.directory",
      ]);
      assert.deepEqual(stdout.trim().split("\n"), [repoRoot, "*"]);
      assert.equal(
        await new CiRepository(repoRoot)
          .hasWorkingTreeChanges()
          .then(CiResultAssertions.assertSuccess),
        false,
      );
    } finally {
      if (hadGlobalConfig) process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
      else delete process.env.GIT_CONFIG_GLOBAL;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  void it("disables editor-controlled hooks for trusted publication", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "nook-ci-agent-hooks-"));
    const repoRoot = join(tempRoot, "repo");
    const remoteRoot = join(tempRoot, "remote.git");
    const hooksRoot = join(repoRoot, "attacker-hooks");
    const marker = join(tempRoot, "hook-ran");
    const pushLog = join(tempRoot, "push.json");
    const fakeGitRoot = join(tempRoot, "bin");
    const fakeGit = join(fakeGitRoot, "git");
    const previousToken = process.env.NOOK_GITHUB_PAT;
    const previousServerUrl = process.env.GITHUB_SERVER_URL;
    const previousRepository = process.env.GITHUB_REPOSITORY;
    const previousPath = process.env.PATH;
    const previousRealGit = process.env.CI_TEST_REAL_GIT;
    const previousRemoteRoot = process.env.CI_TEST_REMOTE_ROOT;
    const previousPushLog = process.env.CI_TEST_PUSH_LOG;
    const git = (...args: string[]) =>
      execFileAsync("git", ["-C", repoRoot, ...args]);
    try {
      await execFileAsync("git", ["init", "--bare", remoteRoot]);
      await mkdir(repoRoot);
      await git("init");
      await git("config", "user.name", "test");
      await git("config", "user.email", "test@example.com");
      await writeFile(join(repoRoot, "README.md"), "base\n");
      await git("add", "README.md");
      await git("commit", "-m", "base");
      await git("remote", "add", "origin", remoteRoot);
      await git("push", "origin", "HEAD");

      await mkdir(hooksRoot);
      const hook = join(hooksRoot, "capture-token");
      await writeFile(
        hook,
        `#!/bin/sh\nprintf '%s' "$NOOK_GITHUB_PAT" > '${marker}'\n`,
      );
      await chmod(hook, 0o755);
      for (const name of ["post-checkout", "pre-commit", "pre-push"]) {
        await writeFile(join(hooksRoot, name), `#!/bin/sh\n"${hook}"\n`);
        await chmod(join(hooksRoot, name), 0o755);
      }
      await git("config", "core.hooksPath", "attacker-hooks");
      await writeFile(join(repoRoot, "README.md"), "trusted update\n");
      await mkdir(fakeGitRoot);
      const realGit = (
        await execFileAsync("which", ["git"], { encoding: "utf8" })
      ).stdout.trim();
      await writeFile(
        fakeGit,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const push = args.includes("push");
const environment = { ...process.env };
if (push) {
  appendFileSync(
    process.env.CI_TEST_PUSH_LOG,
    JSON.stringify({
      args,
      allowProtocol: process.env.GIT_ALLOW_PROTOCOL,
      configGlobal: process.env.GIT_CONFIG_GLOBAL,
      configNoSystem: process.env.GIT_CONFIG_NOSYSTEM,
      noReplaceObjects: process.env.GIT_NO_REPLACE_OBJECTS,
    }) + "\\n",
  );
  const remoteIndex = args.indexOf("https://github.com/meta-secret/nook.git");
  if (remoteIndex >= 0) args[remoteIndex] = process.env.CI_TEST_REMOTE_ROOT;
  for (const option of ["protocol.allow=never", "protocol.file.allow=never"]) {
    const configIndex = args.indexOf(option);
    if (configIndex > 0 && args[configIndex - 1] === "-c") {
      args.splice(configIndex - 1, 2);
      delete environment.GIT_ALLOW_PROTOCOL;
    }
  }
}
const result = spawnSync(process.env.CI_TEST_REAL_GIT, args, {
  encoding: "utf8",
  env: environment,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`,
      );
      await chmod(fakeGit, 0o755);
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "meta-secret/nook";
      process.env.CI_TEST_REAL_GIT = realGit;
      process.env.CI_TEST_REMOTE_ROOT = remoteRoot;
      process.env.CI_TEST_PUSH_LOG = pushLog;
      process.env.PATH = `${fakeGitRoot}:${previousPath}`;
      process.env.NOOK_GITHUB_PAT = "publication-secret";

      await new CiRepository(repoRoot)
        .pushFixBranch({
          fixBranch: "fix/dependency-update",
          runId: "42",
        })
        .then(CiResultAssertions.assertSuccess);

      await assert.rejects(access(marker), /ENOENT/);
      const publication = JSON.parse(await readFile(pushLog, "utf8")) as {
        args: string[];
        allowProtocol: string;
        configGlobal: string;
        configNoSystem: string;
        noReplaceObjects: string;
      };
      assert.ok(publication.args.includes("--no-verify"));
      assert.ok(
        publication.args.includes("https://github.com/meta-secret/nook.git"),
      );
      assert.ok(
        publication.args.includes(
          "HEAD:refs/heads/fix/dependency-update",
        ),
      );
      assert.ok(!publication.args.includes("origin"));
      assert.equal(publication.allowProtocol, "https");
      assert.equal(publication.configGlobal, "/dev/null");
      assert.equal(publication.configNoSystem, "1");
      assert.equal(publication.noReplaceObjects, "1");
      const { stdout } = await execFileAsync("git", [
        "--git-dir",
        remoteRoot,
        "rev-parse",
        "refs/heads/fix/dependency-update",
      ]);
      assert.match(stdout.trim(), /^[0-9a-f]{40}$/u);

      await git(
        "config",
        "url.https://evil.example/.insteadOf",
        "https://github.com/",
      );
      await writeFile(join(repoRoot, "README.md"), "rewritten update\n");
      await new CiRepository(repoRoot)
        .pushFixBranch({
          fixBranch: "fix/dependency-update",
          runId: "43",
        })
        .then((result) =>
          CiResultAssertions.assertFailure(result, /git command failed/u),
        );
      assert.equal(
        (await readFile(pushLog, "utf8")).trim().split("\n").length,
        1,
      );
    } finally {
      if (typeof previousToken === "string")
        process.env.NOOK_GITHUB_PAT = previousToken;
      else delete process.env.NOOK_GITHUB_PAT;
      if (typeof previousServerUrl === "string")
        process.env.GITHUB_SERVER_URL = previousServerUrl;
      else delete process.env.GITHUB_SERVER_URL;
      if (typeof previousRepository === "string")
        process.env.GITHUB_REPOSITORY = previousRepository;
      else delete process.env.GITHUB_REPOSITORY;
      if (typeof previousPath === "string") process.env.PATH = previousPath;
      else delete process.env.PATH;
      if (typeof previousRealGit === "string")
        process.env.CI_TEST_REAL_GIT = previousRealGit;
      else delete process.env.CI_TEST_REAL_GIT;
      if (typeof previousRemoteRoot === "string")
        process.env.CI_TEST_REMOTE_ROOT = previousRemoteRoot;
      else delete process.env.CI_TEST_REMOTE_ROOT;
      if (typeof previousPushLog === "string")
        process.env.CI_TEST_PUSH_LOG = previousPushLog;
      else delete process.env.CI_TEST_PUSH_LOG;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  void it("excludes forced runtime artifacts while retaining authored changes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "nook-ci-agent-git-"));
    try {
      await execFileAsync("git", ["-C", repoRoot, "init"]);
      await writeFile(join(repoRoot, "README.md"), "base\n");
      await execFileAsync("git", ["-C", repoRoot, "add", "README.md"]);
      await execFileAsync("git", [
        "-C",
        repoRoot,
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "base",
      ]);
      await writeFile(
        join(repoRoot, ".nook-workbench-plan.md"),
        "trusted plan\n",
      );
      await writeFile(
        join(repoRoot, ".nook-workbench-worklog.md"),
        "candidate log\n",
      );
      await execFileAsync("git", [
        "-C",
        repoRoot,
        "add",
        "-f",
        ".nook-workbench-plan.md",
        ".nook-workbench-worklog.md",
      ]);
      assert.equal(
        await new CiRepository(repoRoot)
          .hasWorkingTreeChanges()
          .then(CiResultAssertions.assertSuccess),
        false,
      );
      await writeFile(join(repoRoot, "README.md"), "authored change\n");
      assert.equal(
        await new CiRepository(repoRoot)
          .hasWorkingTreeChanges()
          .then(CiResultAssertions.assertSuccess),
        true,
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
