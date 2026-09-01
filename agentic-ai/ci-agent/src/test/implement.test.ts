import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { AuthoredChangeBudgetExceededError } from "../main/git.js";
import {
  CiEditOutcome,
  CiImplementationMode,
  ImplementPrTargetKind,
  preserveImplementedBranchBeforePr as preserve,
  recordTrustedBudgetBlocker,
  runCiImplementationPhases,
  resolveImplementPrTarget,
} from "../main/implement.js";

test("trusted budget rejection is exported for blocked worklog publication", () => {
  const root = mkdtempSync(join(tmpdir(), "nook-budget-blocker-"));
  const output = join(root, "github-output");
  try {
    const error = new AuthoredChangeBudgetExceededError(
      "Implemented diff exceeds the 2000 authored changed-line budget: 2001",
    );
    recordTrustedBudgetBlocker(error, output);
    const encoded = readFileSync(output, "utf8").trim().split("=")[1];
    assert.equal(Buffer.from(encoded, "base64").toString("utf8"), error.message);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function step<T>(log: string[], name: string, value: T): Promise<T> {
  log.push(name);
  return value;
}

function deliveryArgs(log: string[]) {
  const mark = (name: string): void => {
    log.push(name);
  };
  const notFound = { kind: OpenPrLookupKind.NotFound as const };
  return {
    agentBranch: "agent/test",
    assertBudget: async () => mark("budget"),
    createPr: () => step(log, "create-pr", 73),
    findPr: () => step(log, "find-pr", notFound),
    pushBranch: async () => mark("push"),
    verifyBranch: () => step(log, "verify-origin", true),
    verifyPublishedHead: async () => mark("verify-head"),
  };
}

test("oversized implementation is rejected before push", async () => {
  const events: string[] = [];
  const args = deliveryArgs(events);
  const budgetError = new AuthoredChangeBudgetExceededError(
    "exceeds the 2000 authored changed-line budget: 2001",
  );
  args.assertBudget = async () => {
    events.push("budget");
    throw budgetError;
  };
  await assert.rejects(preserve(args), (error) => error === budgetError);
  assert.deepEqual(events, ["budget"]);
});

test("budget measurement errors abort before branch preservation", async () => {
  const events: string[] = [];
  const args = deliveryArgs(events);
  const measurementError = new Error("unmeasurable authored source");
  args.assertBudget = async () => {
    events.push("budget");
    throw measurementError;
  };
  await assert.rejects(preserve(args), (error) => error === measurementError);
  assert.deepEqual(events, ["budget"]);
});

test("bounded implementation keeps the normal push, budget, and PR creation path", async () => {
  const events: string[] = [];
  assert.equal(await preserve(deliveryArgs(events)), 73);

  assert.equal(
    events.join(),
    "budget,push,verify-origin,verify-head,find-pr,create-pr",
  );
});

test("legacy implement short-circuits an existing PR and otherwise delivers once", async () => {
  const existingEvents: string[] = [];
  await runCiImplementationPhases({
    deliver: async () => {
      existingEvents.push("deliver");
    },
    edit: async () => {
      existingEvents.push("edit");
      return CiEditOutcome.Changed;
    },
    legacyPrExists: async () => {
      existingEvents.push("find-pr");
      return true;
    },
    mode: CiImplementationMode.LegacyMonolithic,
  });
  assert.deepEqual(existingEvents, ["find-pr"]);

  const legacyEvents: string[] = [];
  await runCiImplementationPhases({
    deliver: async () => {
      legacyEvents.push("deliver");
    },
    edit: async () => {
      legacyEvents.push("edit");
      return CiEditOutcome.Changed;
    },
    legacyPrExists: async () => {
      legacyEvents.push("find-pr");
      return false;
    },
    mode: CiImplementationMode.LegacyMonolithic,
  });
  assert.deepEqual(legacyEvents, ["find-pr", "edit", "deliver"]);

  const editOnlyEvents: string[] = [];
  await runCiImplementationPhases({
    deliver: async () => {
      editOnlyEvents.push("deliver");
    },
    edit: async () => {
      editOnlyEvents.push("edit");
      return CiEditOutcome.Changed;
    },
    legacyPrExists: async () => {
      editOnlyEvents.push("find-pr");
      return true;
    },
    mode: CiImplementationMode.EditOnly,
  });
  assert.deepEqual(editOnlyEvents, ["edit"]);
});

describe("resolveImplementPrTarget", () => {
  it("keeps standalone work based on main", () => {
    assert.deepEqual(
      resolveImplementPrTarget({
        branch: "agent/workbench-feature-42",
        baseBranch: "main",
        kind: ImplementPrTargetKind.Standalone,
      }),
      {
        kind: ImplementPrTargetKind.Standalone,
        branch: "agent/workbench-feature-42",
        baseBranch: "main",
        budgetBaseRef: "origin/main",
      },
    );
  });

  it("rejects stacked and malformed targets", () => {
    assert.throws(
      () =>
        resolveImplementPrTarget({
          branch: "codex/feature-successor",
          baseBranch: "codex/feature-predecessor",
          kind: "stacked",
        }),
      /Only standalone implement PRs are supported/,
    );
    assert.throws(() =>
      resolveImplementPrTarget({
        branch: "codex/feature successor",
        baseBranch: "main",
        kind: ImplementPrTargetKind.Standalone,
      }),
    );
  });
});
