import assert from "node:assert/strict";
import test from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { preserveImplementedBranchBeforePr as preserve } from "../main/implement.js";

async function step<T>(log: string[], name: string, value: T): Promise<T> {
  log.push(name);
  return value;
}

function deliveryArgs(log: string[]) {
  const notFound = { kind: OpenPrLookupKind.NotFound as const };
  return {
    agentBranch: "agent/test",
    assertBudget: () => step(log, "budget", undefined),
    createPr: () => step(log, "create-pr", 73),
    findPr: () => step(log, "find-pr", notFound),
    pushBranch: () => step(log, "push", undefined),
    verifyBranch: () => step(log, "verify-origin", true),
  };
}

test("oversized implementation is pushed and preserved before budget rejection", async () => {
  const events: string[] = [];
  const args = deliveryArgs(events);
  args.assertBudget = async () => {
    await step(events, "budget", undefined);
    throw new Error("exceeds the 2000 authored changed-line budget: 2001");
  };
  await assert.rejects(
    preserve(args),
    /exceeds the 2000 authored changed-line budget: 2001/,
  );
  assert.deepEqual(events, ["push", "verify-origin", "budget"]);
});

test("bounded implementation keeps the normal push, budget, and PR creation path", async () => {
  const events: string[] = [];
  assert.equal(await preserve(deliveryArgs(events)), 73);

  assert.equal(events.join(), "push,verify-origin,budget,find-pr,create-pr");
});
