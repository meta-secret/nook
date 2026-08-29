import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

import { OpenPrLookupKind } from "../main/github.js";
import { AuthoredChangeBudgetExceededError } from "../main/git.js";
import {
  CiEditOutcome,
  CiImplementationMode,
  ImplementPrTargetKind,
  preserveImplementedBranchBeforePr as preserve,
  runCiImplementationPhases,
  resolveImplementPrTarget,
  validateStackDeliveryState,
} from "../main/implement.js";

const REPOSITORY = { owner: "meta-secret", repo: "nook" };
const SUCCESSOR = "codex/successor";
const PREDECESSOR = "codex/predecessor";
const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const MAIN_SHA = "c".repeat(40);
const MERGE_SHA = "d".repeat(40);
const PREDECESSOR_HEAD_SHA = "e".repeat(40);
const PREDECESSOR_PARENT_SHA = "f".repeat(40);
const TREE_SHA = "1".repeat(40);

enum PullState {
  Closed = "closed",
  Open = "open",
}

enum ApiFailure {
  Compare = "compare",
  None = "",
  Stack = "stack",
}

enum ComparisonStatus {
  Ahead = "ahead",
}

type StackScenario = {
  apiFailure: ApiFailure;
  baseBranch: string;
  baseSha: string;
  comparisons: Array<{ behind_by: number; status: ComparisonStatus }>;
  commits: Array<{
    commit: { tree: { sha: string } };
    parents: Array<{ sha: string }>;
  }>;
  mainSha: string;
  predecessor: {
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
    merge_commit_sha: string;
    merged: boolean;
    merged_at: string;
    state: PullState;
  };
  stacks: Array<{
    base: { ref: string };
    open: boolean;
    pull_requests: Array<{
      head: { ref: string };
      merged_at: string;
      number: number;
      state: PullState;
    }>;
  }>;
  successor: {
    base: { ref: string; sha: string };
    head: { ref: string; repo: { full_name: string }; sha: string };
    state: PullState;
  };
};

function premergeScenario(): StackScenario {
  return {
    apiFailure: ApiFailure.None,
    baseBranch: PREDECESSOR,
    baseSha: BASE_SHA,
    comparisons: [{ behind_by: 0, status: ComparisonStatus.Ahead }],
    commits: [],
    mainSha: MAIN_SHA,
    predecessor: {
      base: { ref: "main", sha: PREDECESSOR_PARENT_SHA },
      head: { ref: PREDECESSOR, sha: PREDECESSOR_HEAD_SHA },
      merge_commit_sha: "",
      merged: false,
      merged_at: "",
      state: PullState.Open,
    },
    stacks: [
      {
        base: { ref: "main" },
        open: true,
        pull_requests: [
          {
            head: { ref: PREDECESSOR },
            merged_at: "",
            number: 41,
            state: PullState.Open,
          },
          {
            head: { ref: SUCCESSOR },
            merged_at: "",
            number: 42,
            state: PullState.Open,
          },
        ],
      },
    ],
    successor: {
      base: { ref: PREDECESSOR, sha: BASE_SHA },
      head: {
        ref: SUCCESSOR,
        repo: { full_name: "meta-secret/nook" },
        sha: HEAD_SHA,
      },
      state: PullState.Open,
    },
  };
}

function postmergeScenario() {
  const scenario = premergeScenario();
  scenario.baseBranch = "main";
  scenario.baseSha = MAIN_SHA;
  scenario.comparisons = [
    { behind_by: 0, status: ComparisonStatus.Ahead },
    { behind_by: 0, status: ComparisonStatus.Ahead },
  ];
  scenario.commits = [
    {
      commit: { tree: { sha: TREE_SHA } },
      parents: [{ sha: PREDECESSOR_PARENT_SHA }],
    },
    { commit: { tree: { sha: TREE_SHA } }, parents: [] },
  ];
  scenario.predecessor.merge_commit_sha = MERGE_SHA;
  scenario.predecessor.merged = true;
  scenario.predecessor.merged_at = "2026-08-29T00:00:00Z";
  scenario.predecessor.state = PullState.Closed;
  scenario.stacks[0].pull_requests[0] = {
    head: { ref: PREDECESSOR },
    merged_at: "2026-08-29T00:00:00Z",
    number: 41,
    state: PullState.Closed,
  };
  scenario.successor.base = { ref: "main", sha: MAIN_SHA };
  return scenario;
}

function mockOctokit(scenario: StackScenario) {
  let pullCall = 0;
  let commitCall = 0;
  let compareCall = 0;
  return {
    paginate: async () => {
      if (scenario.apiFailure === ApiFailure.Stack)
        throw new Error("stack API failed");
      return scenario.stacks;
    },
    rest: {
      pulls: {
        get: async () => ({
          data: pullCall++ === 0 ? scenario.successor : scenario.predecessor,
        }),
      },
      repos: {
        compareCommitsWithBasehead: async () => {
          if (scenario.apiFailure === ApiFailure.Compare)
            throw new Error("compare API failed");
          return { data: scenario.comparisons[compareCall++] };
        },
        getBranch: async () => ({
          data: { commit: { sha: scenario.mainSha } },
        }),
        getCommit: async () => ({ data: scenario.commits[commitCall++] }),
      },
    },
  } as never;
}

async function validateScenario(scenario: StackScenario) {
  return validateStackDeliveryState({
    octokit: mockOctokit(scenario),
    repoRef: REPOSITORY,
    branch: SUCCESSOR,
    baseBranch: scenario.baseBranch,
    baseSha: scenario.baseSha,
    predecessorBranch: PREDECESSOR,
    prNumber: 42,
    startHeadSha: HEAD_SHA,
  });
}

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
    assert.throws(
      () =>
        resolveImplementPrTarget({
          branch: "codex/feature-successor",
          baseBranch: "codex/feature-predecessor",
          kind: ImplementPrTargetKind.Stacked,
        }),
      /frozen PR and base SHA metadata/,
    );
  });
});

describe("validateStackDeliveryState", () => {
  it("accepts exact adjacent premerge and authenticated postmerge states", async () => {
    await validateScenario(premergeScenario());
    await validateScenario(postmergeScenario());
  });

  it("rejects missing or duplicate native stack membership", async () => {
    const missing = premergeScenario();
    missing.stacks = [];
    await assert.rejects(
      validateScenario(missing),
      /unique open GitHub native stack/,
    );
    const duplicate = premergeScenario();
    duplicate.stacks.push(duplicate.stacks[0]);
    await assert.rejects(
      validateScenario(duplicate),
      /unique open GitHub native stack/,
    );
  });

  it("rejects non-adjacency and frozen head or base drift", async () => {
    const adjacency = premergeScenario();
    adjacency.stacks[0].pull_requests[0].head.ref = "codex/other";
    await assert.rejects(validateScenario(adjacency), /no longer adjacent/);
    const drift = premergeScenario();
    drift.successor.head.sha = "9".repeat(40);
    await assert.rejects(
      validateScenario(drift),
      /head or frozen live base changed/,
    );
  });

  it("rejects a closed or merged live predecessor", async () => {
    const scenario = premergeScenario();
    scenario.predecessor.state = PullState.Closed;
    await assert.rejects(
      validateScenario(scenario),
      /must remain open and unmerged/,
    );
  });

  it("rejects invalid postmerge squash and containment proof", async () => {
    const squash = postmergeScenario();
    squash.commits[0].commit.tree.sha = "8".repeat(40);
    await assert.rejects(
      validateScenario(squash),
      /authenticated squash merge/,
    );
    const containment = postmergeScenario();
    containment.comparisons[0].behind_by = 1;
    await assert.rejects(validateScenario(containment), /no longer contains/);
  });

  it("fails closed when native-stack or containment APIs fail", async () => {
    const stackFailure = premergeScenario();
    stackFailure.apiFailure = ApiFailure.Stack;
    await assert.rejects(
      validateScenario(stackFailure),
      /membership is unavailable/,
    );
    const compareFailure = premergeScenario();
    compareFailure.apiFailure = ApiFailure.Compare;
    await assert.rejects(
      validateScenario(compareFailure),
      /compare API failed/,
    );
  });
});
