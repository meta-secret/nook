import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  classifyPullRequestChangedPaths,
  createFixPr,
  PullRequestPathInventoryState,
  requiredPrCheckNames,
  requiredPrWorkflows,
  type PullRequestPathInventory,
} from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };
const inspectable = (paths: string[]): PullRequestPathInventory => ({
  paths,
  state: PullRequestPathInventoryState.Inspectable,
});

test("requiredPrCheckNames maps changed paths to repository-owned gates", () => {
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable([
        ".cortex/AGENTS.md",
        ".cortex/teams/sre/workflows/ci-pipeline.md",
      ]),
    ),
    [],
  );
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable([
        ".github/workflows/repository-policy.yml",
        ".cortex/AGENTS.md",
      ]),
    ),
    ["Enforce repository policy"],
  );
  for (const productPath of [
    ".cortex/teams/sre/workflow.yml",
    ".codex/config.toml",
    ".github/workflows/pr.yml",
    "agentic-ai/minds/Cargo.lock",
    "nook-app/nook-platform/nook-core/src/lib.rs",
  ]) {
    assert.deepEqual(requiredPrCheckNames(inspectable([productPath])), [
      "Verify and preview",
    ]);
  }
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable([
        ".github/workflows/repository-policy.yml",
        "nook-app/nook-platform/nook-core/src/lib.rs",
      ]),
    ),
    ["Enforce repository policy", "Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable(["nook-app/nook-web/nook-web-research/src/main.ts"]),
    ),
    ["Build and deploy research catalog", "Verify and preview"],
  );
  assert.deepEqual(
    requiredPrWorkflows(
      inspectable(["nook-app/nook-platform/nook-core/src/lib.rs"]),
    ),
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
  const productToAiPaths = classifyPullRequestChangedPaths(
    productToAiFiles,
    productToAiFiles.length,
  );
  assert.deepEqual(productToAiPaths.paths, [
    "preflight/src/legacy.rs",
    "agentic-ai/loom/src/legacy.ts",
  ]);
  assert.equal(productToAiPaths.state, PullRequestPathInventoryState.Renamed);
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
  const aiToAiPaths = classifyPullRequestChangedPaths(
    aiToAiFiles,
    aiToAiFiles.length,
  );
  assert.deepEqual(requiredPrCheckNames(aiToAiPaths), ["Verify and preview"]);

  const researchToProductPaths = classifyPullRequestChangedPaths(
    [
      {
        filename: "nook-app/nook-web/src/lib.ts",
        previous_filename: "nook-app/nook-web/nook-web-research/src/legacy.ts",
        status: "renamed",
      },
    ],
    1,
  );
  assert.deepEqual(requiredPrCheckNames(researchToProductPaths), [
    "Build and deploy research catalog",
    "Verify and preview",
  ]);
  const malformedRename = classifyPullRequestChangedPaths(
    [{ filename: "agentic-ai/loom/src/unknown.ts", status: "renamed" }],
    1,
  );
  assert.equal(
    malformedRename.state,
    PullRequestPathInventoryState.Uninspectable,
  );
  assert.match(
    "reason" in malformedRename ? malformedRename.reason : "",
    /lacks source path/u,
  );
});
test("PR file inventory fails closed on truncation and unsupported status", () => {
  const aiFile = { filename: ".cortex/AGENTS.md", status: "modified" };
  const truncated = classifyPullRequestChangedPaths([aiFile], 2);
  assert.equal(truncated.state, PullRequestPathInventoryState.Uninspectable);
  const cappedFiles = Array.from({ length: 3000 }, (_, index) => ({
    filename: `.cortex/generated/${index}.md`,
    status: "added",
  }));
  const capped = classifyPullRequestChangedPaths(
    cappedFiles,
    cappedFiles.length,
  );
  assert.equal(capped.state, PullRequestPathInventoryState.Uninspectable);
  assert.deepEqual(requiredPrCheckNames(capped), [
    "Enforce repository policy",
    "Build and deploy research catalog",
    "Verify and preview",
  ]);
  const unsupported = classifyPullRequestChangedPaths(
    [{ filename: ".cortex/AGENTS.md", status: "invented" }],
    1,
  );
  assert.equal(unsupported.state, PullRequestPathInventoryState.Uninspectable);
  assert.equal(
    classifyPullRequestChangedPaths([], 0).state,
    PullRequestPathInventoryState.Uninspectable,
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
