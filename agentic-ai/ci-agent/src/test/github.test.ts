import { CiResultAssertions } from "./result-assertions.js";
import assert from "node:assert/strict";
import test from "node:test";

import { Octokit } from "@octokit/rest";

import {
  GitHubClient,
  PullRequestCheckSelection,
  PullRequestWorkflowSelection,
} from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

void test("requiredPrCheckNames maps changed paths to repository-owned gates", () => {
  assert.deepEqual(
    new PullRequestCheckSelection([".cortex/AGENTS.md"]).names(),
    [],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-platform/nook-core/src/lib.rs",
    ]).names(),
    ["CI"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-platform/.cargo/config.toml",
    ]).names(),
    ["CI"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection(["preflight/Cargo.lock"]).names(),
    ["CI"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection(["agentic-ai/minds/Cargo.lock"]).names(),
    ["CI"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]).names(),
    ["CI"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-platform/nook-core/src/lib.rs",
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]).names(),
    ["CI"],
  );
  assert.deepEqual(
    new PullRequestWorkflowSelection([
      "nook-app/nook-platform/nook-core/src/lib.rs",
    ]).names(),
    [
      {
        checkName: "CI",
        requiredJobs: [
          "PR validation / Native Rust verification",
          "PR validation / WASM build and artifact",
          "PR validation / WASM Node tests",
          "PR validation / Web verification",
          "PR validation / Verify and preview",
        ],
        workflowFile: "ci.yml",
        workflowName: "CI",
      },
    ],
  );
  assert.deepEqual(
    new PullRequestWorkflowSelection(["agentic-ai/minds/Cargo.lock"]).names(),
    [
      {
        checkName: "CI",
        workflowFile: "ci.yml",
        workflowName: "CI",
        requiredJobs: [
          "Rust ecosystem / Dependency policy and RustSec",
          "Rust ecosystem / Proptest, Insta, and Loom",
          "Rust ecosystem / Cargo fuzz smoke",
          "Rust ecosystem / Kani bounded proofs",
          "Rust ecosystem / Dylint repository lints",
        ],
      },
    ],
  );
});
void test("central CI combines product and research jobs without requiring product for research alone", () => {
  const research = "nook-app/nook-web/nook-web-research/src/main.ts";
  assert.deepEqual(
    new PullRequestWorkflowSelection([research]).names()[0]?.requiredJobs,
    ["Web research / Build and deploy research catalog"],
  );
  const mixed = new PullRequestWorkflowSelection([
    research,
    "nook-app/nook-platform/nook-core/src/lib.rs",
  ]).names();
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0]?.requiredJobs?.length, 6);
  assert.ok(
    mixed[0]?.requiredJobs?.includes("PR validation / Verify and preview"),
  );
});

void test("createFixPr leaves the PR body free of automatic merge control markers", async () => {
  let createdBody = "";
  let createdBase = "";
  const octokit = Object.assign(new Octokit(), {
    rest: {
      pulls: {
        create: async ({ base, body }: { base: string; body: string }) => {
          createdBase = base;
          createdBody = body;
          return { data: { number: 347 } };
        },
      },
    },
  });

  const priorBody = process.env.AGENT_PR_BODY;
  process.env.AGENT_PR_BODY = "## Summary\n\nOpen this PR for review.";
  try {
    const prNumber = await new GitHubClient(octokit)
      .createFixPr({
        repoRef: repoRef,
        headBranch: "agent/fix",
        runId: "run-42",
        fixLabel: "focused issue",
        baseBranch: "codex/predecessor",
      })
      .then(CiResultAssertions.assertSuccess);
    assert.equal(prNumber, 347);
    assert.equal(createdBase, "codex/predecessor");
    assert.equal(createdBody, "## Summary\n\nOpen this PR for review.");
    assert.doesNotMatch(
      createdBody,
      /nook-agent-managed|nook-agent-monitor-wake/,
    );
  } finally {
    if (!priorBody) {
      delete process.env.AGENT_PR_BODY;
    } else {
      process.env.AGENT_PR_BODY = priorBody;
    }
  }
});
