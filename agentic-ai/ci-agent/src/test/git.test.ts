import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import {
  countAuthoredNumstat,
  hasWorkingTreeChanges,
  summarizeAuthoredNumstat,
} from "../main/git.js";

const execFileAsync = promisify(execFile);

describe("countAuthoredNumstat", () => {
  it("counts authored additions and deletions", () => {
    const numstat =
      "12\t3\tsrc/domain.ts\0" + "4\t5\ttests/domain.test.ts\0";
    assert.equal(countAuthoredNumstat(numstat), 24);
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
    assert.equal(countAuthoredNumstat(numstat), 9);
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

  it("skips malformed NUL-delimited records explicitly", () => {
    const numstat = "8\t1\tsrc/domain.ts\0malformed\0";
    assert.equal(countAuthoredNumstat(numstat), 9);
    assert.equal(
      summarizeAuthoredNumstat(numstat).reportedOnly.malformedRecords,
      1,
    );
  });
});

describe("implementation working tree", () => {
  it("excludes forced runtime artifacts while retaining authored changes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "nook-ci-agent-git-"));
    try {
      await execFileAsync("git", ["-C", repoRoot, "init"]);
      await writeFile(join(repoRoot, "README.md"), "base\n");
      await execFileAsync("git", ["-C", repoRoot, "add", "README.md"]);
      await execFileAsync("git", [
        "-C", repoRoot, "-c", "user.name=test", "-c", "user.email=test@example.com",
        "commit", "-m", "base",
      ]);
      await writeFile(join(repoRoot, ".nook-workbench-plan.md"), "trusted plan\n");
      await writeFile(join(repoRoot, ".nook-workbench-worklog.md"), "candidate log\n");
      await execFileAsync("git", ["-C", repoRoot, "add", "-f", ".nook-workbench-plan.md", ".nook-workbench-worklog.md"]);
      assert.equal(await hasWorkingTreeChanges(repoRoot), false);
      await writeFile(join(repoRoot, "README.md"), "authored change\n");
      assert.equal(await hasWorkingTreeChanges(repoRoot), true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
