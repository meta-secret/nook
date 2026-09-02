import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import {
  configureGitForCi,
  countAuthoredNumstat,
  hasWorkingTreeChanges,
  pushFixBranch,
  summarizeAuthoredNumstat,
} from "../main/git.js";

const execFileAsync = promisify(execFile);

describe("countAuthoredNumstat", () => {
  it("counts only authored additions", () => {
    const numstat = "12\t3\tsrc/domain.ts\0" + "4\t5\ttests/domain.test.ts\0";
    assert.equal(countAuthoredNumstat(numstat), 16);
  });

  it("reports generated, lock, snapshot, vendor, binary, and pure rename rows separately", () => {
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
    assert.equal(countAuthoredNumstat(numstat), 8);
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
      summarizeAuthoredNumstat(numstat).reportedOnly,
      expectedReportedOnly,
    );
  });

  it("does not treat source hidden by binary attributes as an excludable binary", () => {
    const numstat = "-\t-\tsrc/domain.ts\0";
    const summary = summarizeAuthoredNumstat(numstat);
    assert.equal(summary.reportedOnly.binaryFiles, 0);
    assert.equal(summary.reportedOnly.unmeasurableAuthoredFiles, 1);
  });

  it("fails closed when a binary source rename hides line counts", () => {
    const numstat = "-\t-\t\0src/old.ts\0src/new.ts\0";
    const summary = summarizeAuthoredNumstat(numstat);
    assert.equal(summary.reportedOnly.pureRenameFiles, 0);
    assert.equal(summary.reportedOnly.unmeasurableAuthoredFiles, 1);
  });

  it("reports a deleted binary source file without requiring an addition count", () => {
    const numstat = "-\t-\tsrc/obsolete.ts\0";
    const summary = summarizeAuthoredNumstat(
      numstat,
      new Set(["src/obsolete.ts"]),
    );
    assert.equal(summary.authoredLines, 0);
    assert.equal(summary.reportedOnly.binaryFiles, 1);
    assert.equal(summary.reportedOnly.unmeasurableAuthoredFiles, 0);
  });

  it("skips malformed NUL-delimited records explicitly", () => {
    const numstat = "8\t1\tsrc/domain.ts\0malformed\0";
    assert.equal(countAuthoredNumstat(numstat), 8);
    assert.equal(
      summarizeAuthoredNumstat(numstat).reportedOnly.malformedRecords,
      1,
    );
  });
});

describe("implementation working tree", () => {
  it("marks the worktree safe before inspecting its state", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "nook-ci-agent-safe-"));
    const repoRoot = join(tempRoot, "repo");
    const globalConfig = join(tempRoot, "global.gitconfig");
    const hadGlobalConfig = Object.hasOwn(process.env, "GIT_CONFIG_GLOBAL");
    const [previousGlobalConfig = ("")] = [process.env.GIT_CONFIG_GLOBAL];
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      await mkdir(repoRoot);
      await execFileAsync("git", ["-C", repoRoot, "init"]);
      await configureGitForCi(repoRoot);
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
      assert.equal(await hasWorkingTreeChanges(repoRoot), false);
    } finally {
      if (hadGlobalConfig) process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
      else delete process.env.GIT_CONFIG_GLOBAL;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("disables editor-controlled hooks for trusted publication", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "nook-ci-agent-hooks-"));
    const repoRoot = join(tempRoot, "repo");
    const remoteRoot = join(tempRoot, "remote.git");
    const hooksRoot = join(repoRoot, "attacker-hooks");
    const marker = join(tempRoot, "hook-ran");
    const previousToken = process.env.NOOK_GITHUB_PAT;
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
      process.env.NOOK_GITHUB_PAT = "publication-secret";

      await pushFixBranch(repoRoot, "fix/dependency-update", "42");

      await assert.rejects(access(marker), /ENOENT/);
      const { stdout } = await execFileAsync("git", [
        "--git-dir",
        remoteRoot,
        "rev-parse",
        "refs/heads/fix/dependency-update",
      ]);
      assert.match(stdout.trim(), /^[0-9a-f]{40}$/u);
    } finally {
      if (typeof previousToken === "string")
        process.env.NOOK_GITHUB_PAT = previousToken;
      else delete process.env.NOOK_GITHUB_PAT;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("excludes forced runtime artifacts while retaining authored changes", async () => {
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
      assert.equal(await hasWorkingTreeChanges(repoRoot), false);
      await writeFile(join(repoRoot, "README.md"), "authored change\n");
      assert.equal(await hasWorkingTreeChanges(repoRoot), true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
