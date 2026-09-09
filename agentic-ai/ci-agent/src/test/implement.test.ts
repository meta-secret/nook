import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { AuthoredChangeBudgetExceededError } from "../main/git.js";
import {
  CiEditOutcome,
  CiChangeKind,
  ChangedCiImplementation,
  CiImplementationPhaseError,
  CiImplementationMode,
  ImplementPrTargetKind,
  AgentImplementationPreserveImplementedBranchBeforePr as AgentImplementationPreserveImplementedBranchBeforePrPreserve,
  AgentImplementationRecordTrustedBudgetBlocker,
  AgentImplementationRunCiImplementationPhases,
  AgentImplementationResolveImplementPrTarget,
} from "../main/implement.js";

interface ImplementStepRequest<T> {
  readonly log: string[];
  readonly name: string;
  readonly value: T;
}

class ImplementStep<T> {
  constructor(private readonly request: ImplementStepRequest<T>) {}
  async execute(): Promise<T> {
    const { log, name, value } = this.request;

    log.push(name);
    return value;
  }
}

class ImplementDeliveryArgs {
  constructor(private readonly request: string[]) {}
  execute() {
    const log = this.request;

    const mark = (name: string): void => {
      log.push(name);
    };
    const notFound = { kind: OpenPrLookupKind.NotFound as const };
    return {
      agentBranch: "agent/test",
      assertBudget: async () => mark("budget"),
      createPr: () =>
        new ImplementStep({ log: log, name: "create-pr", value: 73 }).execute(),
      findPr: () =>
        new ImplementStep({
          log: log,
          name: "find-pr",
          value: notFound,
        }).execute(),
      pushBranch: async () => mark("push"),
      verifyBranch: () =>
        new ImplementStep({
          log: log,
          name: "verify-origin",
          value: true,
        }).execute(),
      verifyPublishedHead: async () => mark("verify-head"),
    };
  }
}

test("trusted budget rejection is exported for blocked worklog publication", () => {
  const root = mkdtempSync(join(tmpdir(), "nook-budget-blocker-"));
  const output = join(root, "github-output");
  try {
    const error = new AuthoredChangeBudgetExceededError(
      "Implemented diff exceeds the 2000 authored-addition budget: 2001",
    );
    new AgentImplementationRecordTrustedBudgetBlocker({
      error: error,
      outputPath: output,
    }).execute();
    const encoded = readFileSync(output, "utf8").trim().split("=")[1];
    assert.equal(
      Buffer.from(encoded, "base64").toString("utf8"),
      error.message,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oversized implementation is rejected before push", async () => {
  const events: string[] = [];
  const args = new ImplementDeliveryArgs(events).execute();
  const budgetError = new AuthoredChangeBudgetExceededError(
    "exceeds the 2000 authored-addition budget: 2001",
  );
  args.assertBudget = async () => {
    events.push("budget");
    throw budgetError;
  };
  await assert.rejects(
    new AgentImplementationPreserveImplementedBranchBeforePrPreserve(
      args,
    ).execute(),
    (error) => error === budgetError,
  );
  assert.deepEqual(events, ["budget"]);
});

test("budget measurement errors abort before branch preservation", async () => {
  const events: string[] = [];
  const args = new ImplementDeliveryArgs(events).execute();
  const measurementError = new Error("unmeasurable authored source");
  args.assertBudget = async () => {
    events.push("budget");
    throw measurementError;
  };
  await assert.rejects(
    new AgentImplementationPreserveImplementedBranchBeforePrPreserve(
      args,
    ).execute(),
    (error) => error === measurementError,
  );
  assert.deepEqual(events, ["budget"]);
});

test("bounded implementation keeps the normal push, budget, and PR creation path", async () => {
  const events: string[] = [];
  assert.equal(
    await new AgentImplementationPreserveImplementedBranchBeforePrPreserve(
      new ImplementDeliveryArgs(events).execute(),
    ).execute(),
    73,
  );

  assert.equal(
    events.join(),
    "budget,push,verify-origin,verify-head,find-pr,create-pr",
  );
});

test("legacy implement short-circuits an existing PR and otherwise delivers once", async () => {
  const existingEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
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
  }).execute();
  assert.deepEqual(existingEvents, ["find-pr"]);

  const legacyEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
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
  }).execute();
  assert.deepEqual(legacyEvents, ["find-pr", "edit", "deliver"]);

  const editOnlyEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
    edit: async () => {
      editOnlyEvents.push("edit");
      return CiEditOutcome.Changed;
    },
    mode: CiImplementationMode.EditOnly,
  }).execute();
  assert.deepEqual(editOnlyEvents, ["edit"]);
});

describe("resolveImplementPrTarget", () => {
  it("keeps standalone work based on main", () => {
    assert.deepEqual(
      new AgentImplementationResolveImplementPrTarget({
        branch: "agent/workbench-feature-42",
        baseBranch: "main",
        kind: ImplementPrTargetKind.Standalone,
      }).execute(),
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
        new AgentImplementationResolveImplementPrTarget({
          branch: "codex/feature-successor",
          baseBranch: "codex/feature-predecessor",
          kind: "stacked",
        }).execute(),
      /Only standalone implement PRs are supported/,
    );
    assert.throws(() =>
      new AgentImplementationResolveImplementPrTarget({
        branch: "codex/feature successor",
        baseBranch: "main",
        kind: ImplementPrTargetKind.Standalone,
      }).execute(),
    );
  });
});

test("a changed implementation consumes delivery before an asynchronous effect", async () => {
  let deliveries = 0;
  const result = await ChangedCiImplementation.edit({
    mode: CiImplementationMode.LegacyMonolithic,
    legacyPrExists: async () => false,
    edit: async () => CiEditOutcome.Changed,
    deliver: async () => {
      deliveries += 1;
    },
  });
  assert.equal(result.kind, CiChangeKind.Deliverable);
  if (result.kind !== CiChangeKind.Deliverable) return;
  const alias = result.change;
  await result.change.deliver();
  await assert.rejects(alias.deliver(), CiImplementationPhaseError);
  assert.equal(deliveries, 1);
});
test("skipped edits never expose a delivery capability", async () => {
  const result = await ChangedCiImplementation.edit({
    mode: CiImplementationMode.LegacyMonolithic,
    legacyPrExists: async () => false,
    edit: async () => CiEditOutcome.Skipped,
    deliver: async () => {
      throw new Error("skipped edit must not deliver");
    },
  });
  assert.deepEqual(result, { kind: CiChangeKind.Skipped });
});
