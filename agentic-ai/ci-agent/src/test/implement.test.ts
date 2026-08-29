import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { AuthoredChangeBudgetExceededError } from "../main/git.js";
import {
  ImplementPrTargetKind,
  preserveImplementedBranchBeforePr as preserve,
  resolveImplementPrTarget,
} from "../main/implement.js";

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

test("oversized implementation is pushed and preserved before budget rejection", async () => {
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
  assert.deepEqual(events, ["budget", "push", "verify-origin", "verify-head"]);
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

  assert.equal(events.join(), "budget,push,verify-origin,verify-head,find-pr,create-pr");
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

  it("bases stacked work and its budget on the predecessor branch", () => {
    assert.deepEqual(
      resolveImplementPrTarget({
        branch: "codex/feature-successor",
        baseBranch: "codex/feature-predecessor",
        baseSha: "a".repeat(40),
        kind: ImplementPrTargetKind.Stacked,
        predecessorBranch: "codex/feature-predecessor",
        prNumber: "1199",
        startHeadSha: "b".repeat(40),
      }),
      {
        kind: ImplementPrTargetKind.Stacked,
        branch: "codex/feature-successor",
        baseBranch: "codex/feature-predecessor",
        baseSha: "a".repeat(40),
        budgetBaseRef: "a".repeat(40),
        predecessorBranch: "codex/feature-predecessor",
        prNumber: 1199,
        startHeadSha: "b".repeat(40),
      },
    );
  });

  it("bases a retargeted stacked successor and its budget on main", () => {
    assert.deepEqual(
      resolveImplementPrTarget({
        branch: "codex/feature-successor",
        baseBranch: "main",
        baseSha: "c".repeat(40),
        kind: ImplementPrTargetKind.Stacked,
        predecessorBranch: "codex/feature-predecessor",
        prNumber: "1199",
        startHeadSha: "d".repeat(40),
      }),
      {
        kind: ImplementPrTargetKind.Stacked,
        branch: "codex/feature-successor",
        baseBranch: "main",
        baseSha: "c".repeat(40),
        budgetBaseRef: "c".repeat(40),
        predecessorBranch: "codex/feature-predecessor",
        prNumber: 1199,
        startHeadSha: "d".repeat(40),
      },
    );
  });

  it("fails closed for incomplete or malformed stack targets", () => {
    assert.throws(() =>
      resolveImplementPrTarget({
        branch: "codex/feature-successor",
        baseBranch: "codex/feature-successor",
        baseSha: "a".repeat(40),
        kind: ImplementPrTargetKind.Stacked,
        predecessorBranch: "codex/feature-predecessor",
        prNumber: "1199",
        startHeadSha: "b".repeat(40),
      }),
    );
    assert.throws(() =>
      resolveImplementPrTarget({
        branch: "codex/feature successor",
        baseBranch: "codex/feature-predecessor",
        baseSha: "a".repeat(40),
        kind: ImplementPrTargetKind.Stacked,
        predecessorBranch: "codex/feature-predecessor",
        prNumber: "1199",
        startHeadSha: "b".repeat(40),
      }),
    );
    assert.throws(() =>
      resolveImplementPrTarget({
        branch: "codex/feature-successor",
        baseBranch: "codex/feature-predecessor",
        kind: ImplementPrTargetKind.Stacked,
      }),
      /frozen PR and base SHA metadata/,
    );
  });
});
