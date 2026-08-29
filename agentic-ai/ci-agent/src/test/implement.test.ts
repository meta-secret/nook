import assert from "node:assert/strict";
import test from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { preserveImplementedBranchBeforePr } from "../main/implement.js";

test("oversized implementation is pushed and preserved before budget rejection", async () => {
  const events: string[] = [];
  let prCreations = 0;

  await assert.rejects(
    preserveImplementedBranchBeforePr({
      agentBranch: "agent/oversized",
      assertBudget: async () => {
        events.push("budget");
        throw new Error(
          "Implemented diff exceeds the 2000 authored changed-line budget: 2001",
        );
      },
      createPr: async () => {
        prCreations += 1;
        events.push("create-pr");
        return 42;
      },
      findPr: async () => {
        events.push("find-pr");
        return { kind: OpenPrLookupKind.NotFound };
      },
      pushBranch: async () => {
        events.push("push");
      },
      verifyBranch: async () => {
        events.push("verify-origin");
        return true;
      },
    }),
    /exceeds the 2000 authored changed-line budget: 2001/,
  );

  assert.deepEqual(events, ["push", "verify-origin", "budget"]);
  assert.equal(prCreations, 0);
});

test("bounded implementation keeps the normal push, budget, and PR creation path", async () => {
  const events: string[] = [];
  const prNumber = await preserveImplementedBranchBeforePr({
    agentBranch: "agent/bounded",
    assertBudget: async () => {
      events.push("budget");
    },
    createPr: async () => {
      events.push("create-pr");
      return 73;
    },
    findPr: async () => {
      events.push("find-pr");
      return { kind: OpenPrLookupKind.NotFound };
    },
    pushBranch: async () => {
      events.push("push");
    },
    verifyBranch: async () => {
      events.push("verify-origin");
      return true;
    },
  });

  assert.equal(prNumber, 73);
  assert.deepEqual(events, [
    "push",
    "verify-origin",
    "budget",
    "find-pr",
    "create-pr",
  ]);
});
