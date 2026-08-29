import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { CiAgentConfig } from "../main/config.js";
import {
  loadPrompt,
  resolveAgentTask,
  resolveMajorChangeAuthorization,
} from "../main/prompt.js";

const ENV_KEYS = [
  "AGENT_PROMPT",
  "MAJOR_CHANGE_AUTHORIZED",
  "VALIDATED_PLAN_SHA256",
  "WORKBENCH_PLAN_FILE",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("resolveMajorChangeAuthorization", () => {
  it("defaults to not authorized", () => {
    assert.equal(resolveMajorChangeAuthorization(), "not-authorized");
  });

  it("accepts only the exact trusted workflow value", () => {
    process.env.MAJOR_CHANGE_AUTHORIZED = "true";
    assert.equal(resolveMajorChangeAuthorization(), "authorized");

    process.env.MAJOR_CHANGE_AUTHORIZED = "TRUE";
    assert.equal(resolveMajorChangeAuthorization(), "not-authorized");
  });
});

describe("resolveAgentTask", () => {
  it("prefers AGENT_PROMPT when set", () => {
    process.env.AGENT_PROMPT = "  Ship the feature  ";
    assert.equal(resolveAgentTask(), "Ship the feature");
  });

  it("throws when the explicit prompt is missing", () => {
    assert.throws(() => resolveAgentTask(), /AGENT_PROMPT is required/);
  });
});

describe("loadPrompt", () => {
  it("loads a legacy template without validated-plan metadata from the trusted tooling root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "nook-ci-agent-prompt-"));
    const toolingRoot = join(parent, "tooling");
    const repoRoot = join(parent, "implementation");
    await Promise.all([
      mkdir(join(toolingRoot, ".github", "prompts"), { recursive: true }),
      mkdir(join(repoRoot, ".github", "prompts"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(toolingRoot, ".github", "prompts", "agent.md"),
        "Trusted: ${AGENT_TASK}",
      ),
      writeFile(
        join(repoRoot, ".github", "prompts", "agent.md"),
        "Untrusted successor prompt",
      ),
    ]);
    const config: CiAgentConfig = {
      repoRoot,
      toolingRoot,
      cursorApiKey: "test-key",
      githubRepository: "meta-secret/nook",
      githubRunId: "42",
      fixBranch: "codex/successor",
      fixLabel: "focused issue",
      promptFile: ".github/prompts/agent.md",
      modelId: "test-model",
    };
    process.env.AGENT_PROMPT = "bounded task";
    try {
      assert.equal(await loadPrompt(config), "Trusted: bounded task");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("embeds only the exact hash-bound validated plan", async () => {
    const parent = await mkdtemp(join(tmpdir(), "nook-ci-agent-plan-"));
    const toolingRoot = join(parent, "tooling");
    const repoRoot = join(parent, "implementation");
    const plan = [
      "# Validated plan",
      "",
      "Keep ${AGENT_TASK}, ${GITHUB_REPOSITORY}, and ${VALIDATED_PLAN} literal.",
      "",
    ].join("\n");
    await Promise.all([
      mkdir(join(toolingRoot, ".github", "prompts"), { recursive: true }),
      mkdir(repoRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(toolingRoot, ".github", "prompts", "agent.md"),
        "Trusted plan:\n${VALIDATED_PLAN}",
      ),
      writeFile(join(repoRoot, ".nook-workbench-plan.md"), plan),
    ]);
    const config: CiAgentConfig = {
      repoRoot,
      toolingRoot,
      cursorApiKey: "test-key",
      githubRepository: "meta-secret/nook",
      githubRunId: "42",
      fixBranch: "codex/successor",
      fixLabel: "focused issue",
      promptFile: ".github/prompts/agent.md",
      modelId: "test-model",
    };
    process.env.WORKBENCH_PLAN_FILE = ".nook-workbench-plan.md";
    process.env.VALIDATED_PLAN_SHA256 = createHash("sha256")
      .update(plan)
      .digest("hex");
    try {
      assert.equal(await loadPrompt(config), `Trusted plan:\n${plan}`);
      await writeFile(join(repoRoot, ".nook-workbench-plan.md"), "changed");
      await assert.rejects(loadPrompt(config), /plan hash changed/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
