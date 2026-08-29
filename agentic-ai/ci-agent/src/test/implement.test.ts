import assert from "node:assert/strict";
import test from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { AuthoredChangeBudgetExceededError } from "../main/git.js";
import { preserveImplementedBranchBeforePr as preserve } from "../main/implement.js";

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
  assert.deepEqual(events, ["budget", "push", "verify-origin"]);
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

  assert.equal(events.join(), "budget,push,verify-origin,find-pr,create-pr");
});
