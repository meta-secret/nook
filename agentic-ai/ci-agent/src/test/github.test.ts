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
  const canonicalAiOnlyPaths = [
    ".agents/skills/example/SKILL.md",
    ".claude/skills/example/SKILL.md",
    ".codex/config.toml",
    ".cortex/AGENTS.md",
    ".cursor/mcp.json",
    ".github/prompts/agent-plan.md",
    ".github/workflows/agent-implement.yml",
    ".github/workflows/ci-agent-smoke.yml",
    ".github/workflows/repository-policy.yml",
    ".task/agentic-ai.yml",
    "AGENTS.md",
    "CODEX.md",
    "agentic-ai/loom/src/cli.ts",
  ];
  for (const canonicalPath of canonicalAiOnlyPaths) {
    assert.deepEqual(requiredPrCheckNames(inspectable([canonicalPath])), [
      "Enforce repository policy",
    ]);
  }
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable([...canonicalAiOnlyPaths, "preflight/Cargo.lock"]),
    ),
    ["Enforce repository policy", "Verify and preview"],
  );
  assert.deepEqual(requiredPrCheckNames(inspectable([".cortex/AGENTS.md"])), [
    "Enforce repository policy",
  ]);
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable(["nook-app/nook-platform/nook-core/src/lib.rs"]),
    ),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable(["nook-app/nook-platform/.cargo/config.toml"]),
    ),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(inspectable(["preflight/Cargo.lock"])),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(inspectable(["agentic-ai/minds/Cargo.lock"])),
    ["Enforce repository policy", "Rust ecosystem checks"],
  );
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable(["agentic-ai/ci-agent/src/main/github.ts"]),
    ),
    ["Enforce repository policy"],
  );
  assert.deepEqual(
    requiredPrCheckNames(inspectable([".github/scripts/ai-routing.test.cjs"])),
    ["Enforce repository policy", "Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable(["nook-app/nook-web/nook-web-research/src/main.ts"]),
    ),
    ["Build and deploy research catalog", "Verify and preview"],
  );
  for (const path of [
    ".github/scripts/web-research-deploy.sh",
    ".github/scripts/web-research-verify-live.sh",
    ".task/ci-workflows.yml",
  ]) {
    assert.deepEqual(requiredPrCheckNames(inspectable([path])), [
      "Build and deploy research catalog",
      "Verify and preview",
    ]);
  }
  assert.deepEqual(
    requiredPrCheckNames(
      inspectable([
        "nook-app/nook-platform/nook-core/src/lib.rs",
        "nook-app/nook-web/nook-web-research/src/main.ts",
      ]),
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
  assert.deepEqual(
    requiredPrWorkflows(inspectable(["agentic-ai/minds/Cargo.lock"])),
    [
      {
        checkName: "Enforce repository policy",
        requiredJobs: ["Enforce repository policy"],
        workflowFile: "repository-policy.yml",
        workflowName: "Repository policy",
      },
      {
        checkName: "Rust ecosystem checks",
        workflowFile: "rust-ecosystem.yml",
        workflowName: "Rust ecosystem checks",
      },
    ],
  );
});
test("renamed PR files preserve source-path validation", () => {
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
    "Enforce repository policy",
    "Verify and preview",
  ]);

  const aiToAiFiles = [
    {
      filename: ".cortex/teams/ai/renamed.md",
      previous_filename: ".cursor/legacy-agent.md",
      status: "renamed",
    },
  ];
  const aiToAiPaths = classifyPullRequestChangedPaths(
    aiToAiFiles,
    aiToAiFiles.length,
  );
  assert.deepEqual(requiredPrCheckNames(aiToAiPaths), [
    "Enforce repository policy",
    "Verify and preview",
  ]);

  for (const [previousFilename, filename] of [
    ["agentic-ai/minds/old.rs", ".cortex/teams/ai/new.md"],
    [".cortex/teams/ai/old.md", "agentic-ai/minds/new.rs"],
  ]) {
    const mindsRenamePaths = classifyPullRequestChangedPaths(
      [
        {
          filename,
          previous_filename: previousFilename,
          status: "renamed",
        },
      ],
      1,
    );
    assert.deepEqual(requiredPrCheckNames(mindsRenamePaths), [
      "Enforce repository policy",
      "Verify and preview",
    ]);
  }
  for (const [previousFilename, filename, expected] of [
    [
      "agentic-ai/ci-agent/src/old.ts",
      ".cortex/new.md",
      ["Enforce repository policy"],
    ],
    [
      ".cortex/old.md",
      "agentic-ai/ci-agent/src/new.ts",
      ["Enforce repository policy"],
    ],
    [
      ".github/scripts/ai-routing.test.cjs",
      ".cortex/new.md",
      ["Enforce repository policy"],
    ],
    [
      ".cortex/old.md",
      ".github/scripts/ai-routing.test.cjs",
      ["Enforce repository policy"],
    ],
  ] as const) {
    const targetedPaths = classifyPullRequestChangedPaths(
      [{ filename, previous_filename: previousFilename, status: "renamed" }],
      1,
    );
    assert.deepEqual(requiredPrCheckNames(targetedPaths), [
      ...expected,
      "Verify and preview",
    ]);
  }
  for (const [previousFilename, filename] of [
    ["nook-app/nook-web/nook-web-research/src/old.ts", ".cortex/new.md"],
    [".cortex/old.md", "nook-app/nook-web/nook-web-research/src/new.ts"],
  ]) {
    const researchRenamePaths = classifyPullRequestChangedPaths(
      [{ filename, previous_filename: previousFilename, status: "renamed" }],
      1,
    );
    assert.deepEqual(requiredPrCheckNames(researchRenamePaths), [
      "Enforce repository policy",
      "Build and deploy research catalog",
      "Verify and preview",
    ]);
  }
  const malformedRename = classifyPullRequestChangedPaths(
    [{ filename: "agentic-ai/loom/src/unknown.ts", status: "renamed" }],
    1,
  );
  assert.equal(
    malformedRename.state,
    PullRequestPathInventoryState.Uninspectable,
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
    "Rust ecosystem checks",
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
