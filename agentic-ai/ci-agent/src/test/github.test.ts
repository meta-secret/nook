import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  changedPathsForPullRequestFiles,
  createFixPr,
  requiredPrCheckNames,
  requiredPrWorkflows,
} from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("requiredPrCheckNames maps changed paths to repository-owned gates", () => {
  assert.deepEqual(requiredPrCheckNames([
    ".cortex/AGENTS.md",
    ".cortex/teams/sre/workflows/ci-pipeline.md",
  ]), []);
  for (const productPath of [
    ".cortex/teams/sre/workflow.yml",
    ".codex/config.toml",
    ".github/workflows/pr.yml",
    "agentic-ai/minds/Cargo.lock",
    "nook-app/nook-platform/nook-core/src/lib.rs",
  ]) {
    assert.deepEqual(requiredPrCheckNames([productPath]), ["Verify and preview"]);
  }
  assert.deepEqual(
    requiredPrCheckNames([
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]),
    ["Build and deploy research catalog", "Verify and preview"],
  );
  assert.deepEqual(
    requiredPrWorkflows(["nook-app/nook-platform/nook-core/src/lib.rs"]),
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
});
test("renamed PR files conservatively require product validation", () => {
  const productToAiFiles = [
    {
      filename: "agentic-ai/loom/src/legacy.ts",
      previous_filename: "preflight/src/legacy.rs",
      status: "renamed",
    },
  ];
  const productToAiPaths = changedPathsForPullRequestFiles(
    productToAiFiles,
    productToAiFiles.length,
  );
  assert.deepEqual(requiredPrCheckNames(productToAiPaths), [
    "Verify and preview",
  ]);

  const aiToAiFiles = [
    {
      filename: ".cortex/teams/ai/renamed.md",
      previous_filename: ".cortex/teams/ai/legacy-agent.md",
      status: "renamed",
    },
  ];
  const aiToAiPaths = changedPathsForPullRequestFiles(
    aiToAiFiles,
    aiToAiFiles.length,
  );
  assert.deepEqual(requiredPrCheckNames(aiToAiPaths), ["Verify and preview"]);

  const researchToProductPaths = changedPathsForPullRequestFiles(
    [
      {
        filename: "nook-app/nook-web/src/lib.ts",
        previous_filename:
          "nook-app/nook-web/nook-web-research/src/legacy.ts",
        status: "renamed",
      },
    ],
    1,
  );
  assert.deepEqual(requiredPrCheckNames(researchToProductPaths), [
    "Build and deploy research catalog",
    "Verify and preview",
  ]);
  assert.throws(
    () =>
      changedPathsForPullRequestFiles(
        [{ filename: "agentic-ai/loom/src/unknown.ts", status: "renamed" }],
        1,
      ),
    /Renamed pull-request file lacks source path/u,
  );
});
test("PR file inventory fails closed on truncation and unsupported status", () => {
  const aiFile = { filename: ".cortex/AGENTS.md", status: "modified" };
  assert.throws(
    () => changedPathsForPullRequestFiles([aiFile], 2),
    /inventory is incomplete: expected 2, received 1/u,
  );
  const cappedFiles = Array.from({ length: 3000 }, (_, index) => ({
    filename: `.cortex/generated/${index}.md`,
    status: "added",
  }));
  assert.throws(
    () => changedPathsForPullRequestFiles(cappedFiles, cappedFiles.length),
    /inventory is incomplete: expected 3000, received 3000/u,
  );
  assert.throws(
    () =>
      changedPathsForPullRequestFiles(
        [{ filename: ".cortex/AGENTS.md", status: "invented" }],
        1,
      ),
    /Unsupported pull-request file status/u,
  );
  assert.throws(
    () => changedPathsForPullRequestFiles([], 0),
    /inventory is incomplete/u,
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
