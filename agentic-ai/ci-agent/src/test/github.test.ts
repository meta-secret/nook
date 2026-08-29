import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  createFixPr,
  requiredPrCheckNames,
  requiredPrWorkflows,
} from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("requiredPrCheckNames maps changed paths to repository-owned gates", () => {
  assert.deepEqual(requiredPrCheckNames([".cortex/AGENTS.md"]), []);
  assert.deepEqual(
    requiredPrCheckNames(["nook-app/nook-platform/nook-core/src/lib.rs"]),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(["nook-app/nook-platform/.cargo/config.toml"]),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(["preflight/Cargo.lock"]),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(["agentic-ai/minds/Cargo.lock"]),
    ["Rust ecosystem checks"],
  );
  assert.deepEqual(
    requiredPrCheckNames(["nook-app/nook-web/nook-web-research/src/main.ts"]),
    ["Build and deploy research catalog"],
  );
  assert.deepEqual(
    requiredPrCheckNames([
      "nook-app/nook-platform/nook-core/src/lib.rs",
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]),
    ["Build and deploy research catalog", "Verify and preview"],
  );
  assert.deepEqual(requiredPrWorkflows(["nook-app/nook-platform/nook-core/src/lib.rs"]), [
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
  ]);
  assert.deepEqual(requiredPrWorkflows(["agentic-ai/minds/Cargo.lock"]), [
    {
      checkName: "Rust ecosystem checks",
      workflowFile: "rust-ecosystem.yml",
      workflowName: "Rust ecosystem checks",
    },
  ]);
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
    const prNumber = await createFixPr(
      octokit,
      repoRef,
      "agent/fix",
      "run-42",
      "focused issue",
      "codex/predecessor",
    );
    assert.equal(prNumber, 347);
    assert.equal(createdBase, "codex/predecessor");
    assert.equal(createdBody, "## Summary\n\nOpen this PR for review.");
    assert.doesNotMatch(createdBody, /nook-agent-managed|nook-agent-monitor-wake/);
  } finally {
    if (!priorBody) {
      delete process.env.AGENT_PR_BODY;
    } else {
      process.env.AGENT_PR_BODY = priorBody;
    }
  }
});
