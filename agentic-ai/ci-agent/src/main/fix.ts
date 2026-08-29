import { execFile } from "node:child_process";
import { chdir } from "node:process";
import { promisify } from "node:util";

import { CiAgentConfigLoadKind, loadConfig } from "./config.js";
import {
  branchExistsOnOrigin,
  createFixPr,
  createOctokit,
  findOpenPr,
  OpenPrLookupKind,
  parseRepository,
} from "./github.js";
import {
  configureGitForCi,
  hasWorkingTreeChanges,
  pushFixBranch,
  revParse,
} from "./git.js";
import { createLogger } from "./logger.js";
import { loadPrompt } from "./prompt.js";
import {
  AgentIsolation,
  restoreHostEnvironment,
  runFixAgent,
} from "./run-agent.js";

const log = createLogger("fix");
const execFileAsync = promisify(execFile);

export enum CiAgentFixProfile {
  Default = "default",
  RustDependencyUpdate = "rust-dependency-update",
}

const VALIDATION_ENV_ALLOWLIST = new Set([
  "BUILDKIT_PROGRESS",
  "BUILDX_BUILDER",
  "CI",
  "DOCKER_BUILDKIT",
  "DOCKER_HOST",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
  "SHELL",
  "TERM",
  "TMPDIR",
]);

type ValidationCommand = {
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
};

export const RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS: readonly ValidationCommand[] =
  [
    {
      args: ["ci:pr:e2e"],
      environment: {
        WASM_BUILD_MODE: "prod",
        VITE_BASE: "/",
        VITE_VAULT_SYNC_INTERVAL_MS: "1000",
      },
    },
    {
      args: ["docker:ecosystem:fuzz", "FUZZ_SECONDS=20"],
      environment: {},
    },
    { args: ["hive:verify"], environment: {} },
  ];

type ValidationRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<void>;

const runValidationCommand: ValidationRunner = async (
  command,
  args,
  options,
) => {
  await execFileAsync(command, [...args], options);
};

export function resolveCiAgentFixProfile(
  value: string | undefined,
): CiAgentFixProfile {
  const profile = value?.trim();
  if (!profile) return CiAgentFixProfile.Default;
  if (profile === CiAgentFixProfile.RustDependencyUpdate) {
    return CiAgentFixProfile.RustDependencyUpdate;
  }
  throw new Error(`Unsupported CI_AGENT_FIX_PROFILE: ${profile}`);
}

export function isolationForFixProfile(
  profile: CiAgentFixProfile,
): AgentIsolation {
  return profile === CiAgentFixProfile.RustDependencyUpdate
    ? AgentIsolation.Strict
    : AgentIsolation.Legacy;
}

export function createValidationEnvironment(
  hostEnvironment: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of VALIDATION_ENV_ALLOWLIST) {
    const value = hostEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return { ...environment, ...overrides };
}

export async function withValidationEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  operation: (sanitized: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const hostEnvironment = { ...environment };
  const validationEnvironment = createValidationEnvironment(hostEnvironment);
  restoreHostEnvironment(validationEnvironment, environment);
  try {
    return await operation(environment);
  } finally {
    restoreHostEnvironment(hostEnvironment, environment);
  }
}

export async function runRustDependencyUpdateValidation(
  repoRoot: string,
  hostEnvironment: NodeJS.ProcessEnv,
  runner: ValidationRunner = runValidationCommand,
): Promise<void> {
  for (const validation of RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS) {
    await runner("task", validation.args, {
      cwd: repoRoot,
      env: createValidationEnvironment(
        hostEnvironment,
        validation.environment,
      ),
    });
  }
}

export async function validateThenPublish(args: {
  validate: () => Promise<void>;
  publish: () => Promise<void>;
}): Promise<void> {
  await args.validate();
  await args.publish();
}

type PublishedFixIdentity = {
  actualBaseRef: string;
  actualHeadRef: string;
  actualHeadSha: string;
  actualPrNumber: number;
  expectedBaseRef: string;
  expectedHeadRef: string;
  expectedHeadSha: string;
  expectedPrNumber: number;
};

export function assertPublishedFixIdentity(
  identity: PublishedFixIdentity,
): string {
  if (identity.actualPrNumber !== identity.expectedPrNumber) {
    throw new Error(
      `Published PR identity changed: expected #${identity.expectedPrNumber}, got #${identity.actualPrNumber}`,
    );
  }
  if (identity.actualHeadRef !== identity.expectedHeadRef) {
    throw new Error(
      `Published PR head branch changed: expected ${identity.expectedHeadRef}, got ${identity.actualHeadRef}`,
    );
  }
  if (identity.actualHeadSha !== identity.expectedHeadSha) {
    throw new Error(
      `Published PR head SHA changed: expected ${identity.expectedHeadSha}, got ${identity.actualHeadSha}`,
    );
  }
  if (identity.actualBaseRef !== identity.expectedBaseRef) {
    throw new Error(
      `Published PR base changed: expected ${identity.expectedBaseRef}, got ${identity.actualBaseRef}`,
    );
  }
  return identity.expectedHeadSha;
}

async function runValidationWithoutPublicationCredentials(
  repoRoot: string,
): Promise<void> {
  await withValidationEnvironment(process.env, (validationEnvironment) =>
    runRustDependencyUpdateValidation(repoRoot, validationEnvironment),
  );
}

export async function runCiFix(): Promise<string | undefined> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }

  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const fixBranch = process.env.FIX_BRANCH?.trim() || `fix/ci-${runId}`;
  const profile = resolveCiAgentFixProfile(process.env.CI_AGENT_FIX_PROFILE);
  chdir(repoRoot);

  const octokit = createOctokit();
  await configureGitForCi(repoRoot, octokit);
  const repoRef = parseRepository(repository);

  let openPr = await findOpenPr(octokit, repoRef, fixBranch);
  let prNumber: number;
  let publishedHead: string | undefined;
  if (openPr.kind === OpenPrLookupKind.Found) {
    prNumber = openPr.number;
    log.info(`Open PR already exists for ${fixBranch} (#${prNumber})`);
  } else {
    const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
    if (!cursorApiKey) {
      console.log(
        "::warning::CURSOR_API_KEY is not set — skipping AI CI fix job.",
      );
      console.log(
        "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys).",
      );
      return undefined;
    }

    const loadedConfig = loadConfig();
    if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
      return undefined;
    }
    const config = loadedConfig.config;

    const prompt = await loadPrompt(config);
    await runFixAgent(config, prompt, isolationForFixProfile(profile));

    if (!(await hasWorkingTreeChanges(repoRoot))) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return undefined;
    }

    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      await validateThenPublish({
        validate: () => runValidationWithoutPublicationCredentials(repoRoot),
        publish: () => pushFixBranch(repoRoot, fixBranch, runId),
      });
    } else {
      await pushFixBranch(repoRoot, fixBranch, runId);
    }

    if (!(await branchExistsOnOrigin(octokit, repoRef, fixBranch))) {
      throw new Error(
        `Fix branch ${fixBranch} was not found on origin after push`,
      );
    }

    openPr = await findOpenPr(octokit, repoRef, fixBranch);
    if (openPr.kind === OpenPrLookupKind.Found) {
      prNumber = openPr.number;
    } else {
      prNumber = await createFixPr(
        octokit,
        repoRef,
        fixBranch,
        runId,
        config.fixLabel,
        "main",
      );
    }
    const localHead = await revParse(repoRoot, "HEAD");
    const { data: publishedPr } = await octokit.rest.pulls.get({
      ...repoRef,
      pull_number: prNumber,
    });
    publishedHead = assertPublishedFixIdentity({
      actualBaseRef: publishedPr.base.ref,
      actualHeadRef: publishedPr.head.ref,
      actualHeadSha: publishedPr.head.sha,
      actualPrNumber: publishedPr.number,
      expectedBaseRef: "main",
      expectedHeadRef: fixBranch,
      expectedHeadSha: localHead,
      expectedPrNumber: prNumber,
    });
    log.info(
      `PR #${prNumber} exact head ${publishedHead} verified and handed to the continuing Gizmo owner`,
    );
  }

  const fixLabel = process.env.CI_FIX_LABEL?.trim() || "main CI";
  log.info(
    `PR #${prNumber} opened for review; no automatic merge is configured`,
  );
  log.info(
    `Done — ${fixLabel} run ${runId} requires explicit merge authorization`,
  );
  return publishedHead;
}
