import { CiResultAssertions } from "./result-assertions.js";
import { ok, err, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "../main/failure.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import {
  CiEditOutcome,
  CiChangeKind,
  LegacyCiEdit,
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
  async execute(): Promise<Result<T, CiFailure>> {
    const { log, name, value } = this.request;

    log.push(name);
    return ok(value);
  }
}

class ImplementDeliveryArgs {
  constructor(private readonly request: string[]) {}
  execute(): ConstructorParameters<
    typeof AgentImplementationPreserveImplementedBranchBeforePrPreserve
  >[0] {
    const log = this.request;

    const mark = (name: string): void => {
      log.push(name);
    };
    const notFound = { kind: OpenPrLookupKind.NotFound as const };
    return {
      agentBranch: "agent/test",
      assertBudget: async () => ok(mark("budget")),
      createPr: () =>
        new ImplementStep({ log: log, name: "create-pr", value: 73 }).execute(),
      findPr: () =>
        new ImplementStep({
          log: log,
          name: "find-pr",
          value: notFound,
        }).execute(),
      pushBranch: async () => ok(mark("push")),
      verifyBranch: () =>
        new ImplementStep({
          log: log,
          name: "verify-origin",
          value: true,
        }).execute(),
      verifyPublishedHead: async () => ok(mark("verify-head")),
    };
  }
}

test("trusted budget rejection is exported for blocked worklog publication", () => {
  const root = mkdtempSync(join(tmpdir(), "nook-budget-blocker-"));
  const output = join(root, "github-output");
  try {
    const error = {
      kind: CiFailureKind.Budget,
      message:
        "Implemented diff exceeds the 2000 authored-addition budget: 2001",
    } satisfies CiFailure;
    CiResultAssertions.assertSuccess(
      new AgentImplementationRecordTrustedBudgetBlocker({
        error: error,
        outputPath: output,
      }).execute(),
    );
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
  const budgetError = {
    kind: CiFailureKind.Budget,
    message: "exceeds the 2000 authored-addition budget: 2001",
  } satisfies CiFailure;
  args.assertBudget = async () => {
    events.push("budget");
    return err(budgetError);
  };
  await CiResultAssertions.assertAsyncFailure(
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
  const measurementError: CiFailure = {
    kind: CiFailureKind.Git,
    message: "unmeasurable authored source",
  };
  args.assertBudget = async () => {
    events.push("budget");
    return err(measurementError);
  };
  await CiResultAssertions.assertAsyncFailure(
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
    )
      .execute()
      .then(CiResultAssertions.assertSuccess),
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

      return ok();
    },
    edit: async () => {
      existingEvents.push("edit");
      return ok(CiEditOutcome.Changed);
    },
    legacyPrExists: async () => {
      existingEvents.push("find-pr");
      return ok(true);
    },
    mode: CiImplementationMode.LegacyMonolithic,
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.deepEqual(existingEvents, ["find-pr"]);

  const legacyEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
    deliver: async () => {
      legacyEvents.push("deliver");

      return ok();
    },
    edit: async () => {
      legacyEvents.push("edit");
      return ok(CiEditOutcome.Changed);
    },
    legacyPrExists: async () => {
      legacyEvents.push("find-pr");
      return ok(false);
    },
    mode: CiImplementationMode.LegacyMonolithic,
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.deepEqual(legacyEvents, ["find-pr", "edit", "deliver"]);

  const editOnlyEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
    edit: async () => {
      editOnlyEvents.push("edit");
      return ok(CiEditOutcome.Changed);
    },
    mode: CiImplementationMode.EditOnly,
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.deepEqual(editOnlyEvents, ["edit"]);
});

describe("resolveImplementPrTarget", () => {
  it("keeps standalone work based on main", () => {
    assert.deepEqual(
      CiResultAssertions.assertSuccess(
        new AgentImplementationResolveImplementPrTarget({
          branch: "agent/workbench-feature-42",
          baseBranch: "main",
          kind: ImplementPrTargetKind.Standalone,
        }).execute(),
      ),
      {
        kind: ImplementPrTargetKind.Standalone,
        branch: "agent/workbench-feature-42",
        baseBranch: "main",
        budgetBaseRef: "origin/main",
      },
    );
  });

  it("rejects stacked and malformed targets", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveImplementPrTarget({
        branch: "codex/feature-successor",
        baseBranch: "codex/feature-predecessor",
        kind: "stacked",
      }).execute(),
      /Only standalone implement PRs are supported/,
    );
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveImplementPrTarget({
        branch: "codex/feature successor",
        baseBranch: "main",
        kind: ImplementPrTargetKind.Standalone,
      }).execute(),
      /./,
    );
  });
});

test("a changed implementation consumes delivery before an asynchronous effect", async () => {
  let deliveries = 0;
  const result = await new LegacyCiEdit({
    mode: CiImplementationMode.LegacyMonolithic,
    legacyPrExists: async () => ok(false),
    edit: async () => ok(CiEditOutcome.Changed),
    deliver: async () => {
      deliveries += 1;

      return ok();
    },
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.equal(result.kind, CiChangeKind.Deliverable);
  if (result.kind !== CiChangeKind.Deliverable) return;
  const alias = result.change;
  await result.change.deliver().then(CiResultAssertions.assertSuccess);
  await CiResultAssertions.assertAsyncFailure(alias.deliver(), /already been consumed/);
  assert.equal(deliveries, 1);
});
test("skipped edits never expose a delivery capability", async () => {
  const result = await new LegacyCiEdit({
    mode: CiImplementationMode.LegacyMonolithic,
    legacyPrExists: async () => ok(false),
    edit: async () => ok(CiEditOutcome.Skipped),
    deliver: async () => {
      return err({
        kind: CiFailureKind.Github,
        message: "skipped edit must not deliver",
      });
    },
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.deepEqual(result, { kind: CiChangeKind.Skipped });
});
