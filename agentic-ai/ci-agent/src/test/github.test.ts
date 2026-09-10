import { assertSuccess } from "./result-assertions.js";
import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  GitHubClient,
  PullRequestCheckSelection,
  PullRequestWorkflowSelection,
} from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("requiredPrCheckNames maps changed paths to repository-owned gates", () => {
  assert.deepEqual(
    new PullRequestCheckSelection([".cortex/AGENTS.md"]).names(),
    [],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-platform/nook-core/src/lib.rs",
    ]).names(),
    ["Verify and preview"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-platform/.cargo/config.toml",
    ]).names(),
    ["Verify and preview"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection(["preflight/Cargo.lock"]).names(),
    ["Verify and preview"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection(["agentic-ai/minds/Cargo.lock"]).names(),
    ["Rust ecosystem checks"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]).names(),
    ["Build and deploy research catalog"],
  );
  assert.deepEqual(
    new PullRequestCheckSelection([
      "nook-app/nook-platform/nook-core/src/lib.rs",
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]).names(),
    ["Build and deploy research catalog", "Verify and preview"],
  );
  assert.deepEqual(
    new PullRequestWorkflowSelection([
      "nook-app/nook-platform/nook-core/src/lib.rs",
    ]).names(),
    [
      {
        checkName: "Verify and preview",
        requiredJobs: [
          "Native Rust verification",
          "WASM build and artifact",
          "WASM Node tests",
          "Web verification",
          "Verify and preview",
        ],
        workflowFile: "pr.yml",
        workflowName: "PR",
      },
    ],
  );
  assert.deepEqual(
    new PullRequestWorkflowSelection(["agentic-ai/minds/Cargo.lock"]).names(),
    [
      {
        checkName: "Rust ecosystem checks",
        workflowFile: "rust-ecosystem.yml",
        workflowName: "Rust ecosystem checks",
      },
    ],
  );
});
test("createFixPr leaves the PR body free of automatic merge control markers", async () => {
  let createdBody = "";
  let createdBase = "";
  const octokit = {
    rest: {
      pulls: {
        create: async ({ base, body }: { base: string; body: string }) => {
          createdBase = base;
          createdBody = body;
          return { data: { number: 347 } };
        },
      },
    },
  } as unknown as Octokit;

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
      .then(assertSuccess);
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
