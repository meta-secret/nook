import { CiResultAssertions } from "./result-assertions.js";
import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "../main/failure.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import {
  AgentImplementationPublishBranch,
  AgentImplementationRecordTrustedBudgetBlocker,
  AgentImplementationResolveDeliveryTarget,
  AgentImplementationRunCiImplementationPhases,
  CiEditOutcome,
  CiImplementationMode,
} from "../main/implement.js";

const EXPECTED_HEAD = "a".repeat(40);

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
  execute(): ConstructorParameters<typeof AgentImplementationPublishBranch>[0] {
    const log = this.request;
    return {
      agentBranch: "agent/test",
      expectedHead: EXPECTED_HEAD,
      assertBudget: async () => {
        log.push("budget");
        return ok();
      },
      pushBranch: async () => {
        log.push("push");
        return ok();
      },
      readPublishedHead: () =>
        new ImplementStep({
          log,
          name: "read-origin-head",
          value: EXPECTED_HEAD,
        }).execute(),
    };
  }
}

void test("trusted budget rejection is exported for blocked worklog publication", () => {
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
        error,
        outputPath: output,
      }).execute(),
    );
    const encoded = readFileSync(output, "utf8").trim().split("=").at(1);
    if (!encoded) throw new Error("Missing encoded budget failure");
    assert.equal(Buffer.from(encoded, "base64").toString("utf8"), error.message);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("oversized implementation is rejected before branch publication", async () => {
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
    new AgentImplementationPublishBranch(args).execute(),
    (error) => error === budgetError,
  );
  assert.deepEqual(events, ["budget"]);
});

void test("agent delivery publishes and verifies one exact branch head without creating a PR", async () => {
  const events: string[] = [];
  const published = await new AgentImplementationPublishBranch(
    new ImplementDeliveryArgs(events).execute(),
  )
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.equal(published, EXPECTED_HEAD);
  assert.deepEqual(events, ["budget", "push", "read-origin-head"]);
});

void test("agent delivery rejects a branch whose remote head changed during publication", async () => {
  const args = new ImplementDeliveryArgs([]).execute();
  args.readPublishedHead = async () => ok("b".repeat(40));
  await CiResultAssertions.assertAsyncFailure(
    new AgentImplementationPublishBranch(args).execute(),
    /published at .* expected/u,
  );
});

void test("implementation phases edit once and publish only changed work", async () => {
  const changedEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
    deliver: async () => {
      changedEvents.push("deliver");
      return ok();
    },
    edit: async () => {
      changedEvents.push("edit");
      return ok(CiEditOutcome.Changed);
    },
    mode: CiImplementationMode.PublishBranch,
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.deepEqual(changedEvents, ["edit", "deliver"]);

  const skippedEvents: string[] = [];
  await new AgentImplementationRunCiImplementationPhases({
    deliver: async () => {
      skippedEvents.push("deliver");
      return ok();
    },
    edit: async () => {
      skippedEvents.push("edit");
      return ok(CiEditOutcome.Skipped);
    },
    mode: CiImplementationMode.PublishBranch,
  })
    .execute()
    .then(CiResultAssertions.assertSuccess);
  assert.deepEqual(skippedEvents, ["edit"]);
});

void test("implementation phases are single-use", async () => {
  let deliveries = 0;
  const phases = new AgentImplementationRunCiImplementationPhases({
    deliver: async () => {
      deliveries += 1;
      return ok();
    },
    edit: async () => ok(CiEditOutcome.Changed),
    mode: CiImplementationMode.PublishBranch,
  });
  await phases.execute().then(CiResultAssertions.assertSuccess);
  await CiResultAssertions.assertAsyncFailure(phases.execute(), /consumed/u);
  assert.equal(deliveries, 1);
});

void describe("resolveDeliveryTarget", () => {
  void it("keeps the budget baseline on origin/main", () => {
    assert.deepEqual(
      CiResultAssertions.assertSuccess(
        new AgentImplementationResolveDeliveryTarget({
          branch: "agent/workbench-feature-42",
        }).execute(),
      ),
      {
        branch: "agent/workbench-feature-42",
        budgetBaseRef: "origin/main",
      },
    );
  });

  void it("rejects malformed branch metadata", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveDeliveryTarget({
        branch: "agent/feature successor",
      }).execute(),
      /malformed/u,
    );
  });
});
