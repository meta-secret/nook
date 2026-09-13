import { CiResultAssertions } from "./result-assertions.js";
import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "../main/failure.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import {
  CiImplementationCommand,
  AgentImplementationPublishBranch,
  AgentImplementationRecordTrustedBudgetBlocker,
  AgentImplementationResolveDeliveryTarget,
  AgentImplementationRunCiImplementationPhases,
  AgentImplementationVerifyBootstrap,
  AgentImplementationValidateBootstrapEvidence,
  CiEditOutcome,
  CiImplementationMode,
} from "../main/implement.js";

const EXPECTED_HEAD = "a".repeat(40);
const ORIGIN_MAIN_SHA = "b".repeat(40);
const PINNED_LOCAL_DEV_SHA = "c".repeat(40);

class BootstrapReplacementFixture {
  private constructor(readonly root: string) {}

  static create(): BootstrapReplacementFixture {
    const root = mkdtempSync(join(tmpdir(), "nook-bootstrap-replacement-"));
    const fixture = new BootstrapReplacementFixture(root);
    fixture.git("init");
    return fixture;
  }

  git(...args: string[]): string {
    const environment = { ...process.env };
    delete environment.GIT_NO_REPLACE_OBJECTS;
    return execFileSync("git", ["-C", this.root, ...args], {
      encoding: "utf8",
      env: environment,
    }).trim();
  }

  gitWithInput(input: string, ...args: string[]): string {
    const environment = { ...process.env };
    delete environment.GIT_NO_REPLACE_OBJECTS;
    return execFileSync("git", ["-C", this.root, ...args], {
      encoding: "utf8",
      env: environment,
      input,
    }).trim();
  }

  commit(message: string, parent?: string): string {
    const file = join(this.root, "fixture.txt");
    writeFileSync(file, `${message}\n`);
    const blob = this.git("hash-object", "-w", file);
    const tree = this.gitWithInput(
      `100644 blob ${blob}\tfixture.txt\n`,
      "mktree",
    );
    const commitArgs = [
      "-c",
      "user.name=CI Fixture",
      "-c",
      "user.email=ci-fixture@example.test",
      "commit-tree",
      tree,
    ];
    if (parent) commitArgs.push("-p", parent);
    commitArgs.push("-m", message);
    return this.git(...commitArgs);
  }

  replaceCommit(target: string, parent: string): void {
    const replacement = this.commit("replacement", parent);
    this.git("replace", target, replacement);
  }

  head(commit: string): void {
    this.git("update-ref", "refs/heads/fixture", commit);
    this.git("symbolic-ref", "HEAD", "refs/heads/fixture");
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

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
      agentBranch: "codex/agent-branching",
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

void test("feature delivery publishes and verifies one exact branch head without creating a PR", async () => {
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
  void it(
    "records fetched-main evidence and uses the pinned local-dev base",
    () => {
      assert.deepEqual(
        CiResultAssertions.assertSuccess(
          new AgentImplementationResolveDeliveryTarget({
            branch: "codex/agent-branching",
            originMainSha: ORIGIN_MAIN_SHA,
            pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
          }).execute(),
        ),
        {
          branch: "codex/agent-branching",
          originMainSha: ORIGIN_MAIN_SHA,
          pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
          budgetBaseRef: PINNED_LOCAL_DEV_SHA,
        },
      );
    },
  );

  void it("accepts a canonical child branch for a registered team role", () => {
    assert.deepEqual(
      CiResultAssertions.assertSuccess(
        new AgentImplementationResolveDeliveryTarget({
          branch:
            "codex/agent-branching/ai/loom-specialist/define-branch-naming-contract",
          originMainSha: ORIGIN_MAIN_SHA,
          pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
        }).execute(),
      ),
      {
        branch:
          "codex/agent-branching/ai/loom-specialist/define-branch-naming-contract",
        originMainSha: ORIGIN_MAIN_SHA,
        pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
        budgetBaseRef: PINNED_LOCAL_DEV_SHA,
      },
    );
  });

  void it("rejects legacy feature branches", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveDeliveryTarget({
        branch: "agent/workbench-feature-42",
        originMainSha: ORIGIN_MAIN_SHA,
        pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
      }).execute(),
      /malformed/u,
    );
  });

  void it("rejects an unregistered team and role combination", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveDeliveryTarget({
        branch:
          "codex/agent-branching/ai/dev-manager/define-branch-naming-contract",
        originMainSha: ORIGIN_MAIN_SHA,
        pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
      }).execute(),
      /malformed/u,
    );
  });

  void it("rejects malformed branch metadata", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveDeliveryTarget({
        branch: "codex/feature",
        originMainSha: ORIGIN_MAIN_SHA,
        pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
      }).execute(),
      /malformed/u,
    );
  });

  void it("fails closed when bootstrap evidence is missing", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveDeliveryTarget({
        branch: "codex/agent-branching",
        originMainSha: "",
        pinnedLocalDevSha: "",
      }).execute(),
      /bootstrap evidence requires/u,
    );
  });

  void it("rejects abbreviated or non-hex bootstrap evidence", () => {
    CiResultAssertions.assertFailure(
      new AgentImplementationResolveDeliveryTarget({
        branch: "codex/agent-branching",
        originMainSha: "main",
        pinnedLocalDevSha: "dev",
      }).execute(),
      /bootstrap evidence requires/u,
    );
  });
});

void describe("validateBootstrapEvidence", () => {
  void it("preserves both exact commit identities", () => {
    assert.deepEqual(
      CiResultAssertions.assertSuccess(
        new AgentImplementationValidateBootstrapEvidence({
          originMainSha: ORIGIN_MAIN_SHA,
          pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
        }).execute(),
      ),
      {
        originMainSha: ORIGIN_MAIN_SHA,
        pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
      },
    );
  });
});

void describe("resolveTargetFromEnvironment", () => {
  void it("consumes the existing prime feature branch", () => {
    const target = new CiImplementationCommand({
      GITHUB_RUN_ID: "410",
      AGENT_BRANCH: "codex/agent-branching",
      ORIGIN_MAIN_SHA,
      PINNED_LOCAL_DEV_SHA,
    }).resolveTargetFromEnvironment();
    assert.deepEqual(CiResultAssertions.assertSuccess(target), {
      branch: "codex/agent-branching",
      originMainSha: ORIGIN_MAIN_SHA,
      pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
      budgetBaseRef: PINNED_LOCAL_DEV_SHA,
    });
  });

  void it("fails closed when the existing branch metadata is absent", () => {
    const target = new CiImplementationCommand({
      GITHUB_RUN_ID: "410",
      ORIGIN_MAIN_SHA,
      PINNED_LOCAL_DEV_SHA,
    }).resolveTargetFromEnvironment();
    CiResultAssertions.assertFailure(target, /branch metadata is malformed/u);
  });
});

void test("bootstrap verification rejects replacement-ref ancestry bypasses", async () => {
  const fixture = BootstrapReplacementFixture.create();
  try {
    const originMainSha = fixture.commit("origin main");
    const pinnedLocalDevSha = fixture.commit("pinned local dev");
    fixture.git("update-ref", "refs/remotes/origin/main", originMainSha);
    fixture.head(pinnedLocalDevSha);
    fixture.replaceCommit(pinnedLocalDevSha, originMainSha);

    const result = await new AgentImplementationVerifyBootstrap({
      repoRoot: fixture.root,
      evidence: { originMainSha, pinnedLocalDevSha },
    }).execute();
    CiResultAssertions.assertFailure(
      result,
      /not based on the Prime-pinned local-dev SHA/u,
    );
  } finally {
    fixture.dispose();
  }
});
