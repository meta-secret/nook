import { execFile, spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chdir } from "node:process";
import { promisify } from "node:util";

import { CiAgentConfigLoadKind, loadConfig } from "./config.js";
import {
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

export const runValidationCommand: ValidationRunner = async (
  command,
  args,
  options,
) => {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], {
      ...options,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      const failure = signal
        ? `terminated by signal ${signal}`
        : code === 0
          ? undefined
          : `exited with code ${code}`;
      if (failure)
        rejectRun(new Error(`${command} ${args.join(" ")} ${failure}`));
      else resolveRun();
    });
  });
};

export type RepositoryBaseline = {
  headSha: string;
  indexTreeSha: string;
};

type ChangedPath = {
  path: string;
  status: string;
};

type BaselineModeLookup = (path: string) => Promise<string | undefined>;

type GitConfigEntry = {
  key: string;
  value: string;
};

const RUST_DEPENDENCY_ROOTS = [
  "agentic-ai/minds/",
  "nook-app/nook-platform/",
  "preflight/",
] as const;

function isAllowedRustDependencyPath(path: string): boolean {
  if (!RUST_DEPENDENCY_ROOTS.some((root) => path.startsWith(root))) {
    return false;
  }
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return (
    basename === "Cargo.toml" ||
    basename === "Cargo.lock" ||
    path.endsWith(".rs")
  );
}

function isOrchestrationControlPath(path: string): boolean {
  const lower = path.toLowerCase();
  const basename = lower.slice(lower.lastIndexOf("/") + 1);
  return (
    /(^|\/)(?:\.github|\.task|\.cursor|scripts)\//u.test(lower) ||
    /^(?:taskfile\.ya?ml|makefile|justfile|build\.rs|dockerfile(?:\..*)?|docker-compose.*)$/u.test(
      basename,
    ) ||
    basename.includes("bake")
  );
}

function parseNulSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

export function parsePorcelainStatus(output: string): ChangedPath[] {
  const records = parseNulSeparated(output);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Malformed Git status record");
    }
    const status = record.slice(0, 2);
    changes.push({ path: record.slice(3), status });
    if (status.includes("R") || status.includes("C")) {
      const source = records[index + 1];
      if (!source) throw new Error("Malformed Git rename status record");
      changes.push({ path: source, status });
      index += 1;
    }
  }
  return changes;
}

async function gitOutput(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
  });
  return stdout;
}

async function currentIndexTree(repoRoot: string): Promise<string> {
  return (await gitOutput(repoRoot, ["write-tree"])).trim();
}

export async function captureRepositoryBaseline(
  repoRoot: string,
): Promise<RepositoryBaseline> {
  const headSha = await revParse(repoRoot, "HEAD");
  const headTreeSha = await revParse(repoRoot, "HEAD^{tree}");
  const indexTreeSha = await currentIndexTree(repoRoot);
  if (indexTreeSha !== headTreeSha) {
    throw new Error("Trusted dependency-update baseline index is not clean");
  }
  if ((await collectChangedPaths(repoRoot)).length !== 0) {
    throw new Error("Trusted dependency-update baseline checkout is not clean");
  }
  return { headSha, indexTreeSha };
}

export function assertRepositoryBaselineUnchanged(args: {
  baseline: RepositoryBaseline;
  currentHeadSha: string;
  currentIndexTreeSha: string;
}): void {
  if (args.currentHeadSha !== args.baseline.headSha) {
    throw new Error("Bounded editor changed the trusted baseline HEAD");
  }
  if (args.currentIndexTreeSha !== args.baseline.indexTreeSha) {
    throw new Error("Bounded editor changed the trusted baseline index");
  }
}

async function assertBaselineUnchanged(
  repoRoot: string,
  baseline: RepositoryBaseline,
): Promise<void> {
  assertRepositoryBaselineUnchanged({
    baseline,
    currentHeadSha: await revParse(repoRoot, "HEAD"),
    currentIndexTreeSha: await currentIndexTree(repoRoot),
  });
}

async function collectChangedPaths(repoRoot: string): Promise<ChangedPath[]> {
  const status = await gitOutput(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
  ]);
  return parsePorcelainStatus(status);
}

export async function assertRustDependencyUpdateChangeSet(
  repoRoot: string,
  changes: readonly ChangedPath[],
  baselineModeForPath?: BaselineModeLookup,
): Promise<void> {
  if (changes.length === 0) {
    throw new Error("Trusted dependency-update change set is empty");
  }
  const root = resolve(repoRoot);
  for (const change of changes) {
    if (change.path.startsWith("/") || change.path.split("/").includes("..")) {
      throw new Error("Dependency-update path escapes the repository");
    }
    if (isOrchestrationControlPath(change.path)) {
      throw new Error(
        `Dependency update changed trusted orchestration control: ${change.path}`,
      );
    }
    if (!isAllowedRustDependencyPath(change.path)) {
      throw new Error(
        `Dependency update changed forbidden path: ${change.path}`,
      );
    }
    const absolutePath = resolve(root, change.path);
    if (!absolutePath.startsWith(`${root}${sep}`)) {
      throw new Error("Dependency-update path escapes the repository");
    }
    try {
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile()) {
        throw new Error(
          `Dependency update produced a symlink or special file: ${change.path}`,
        );
      }
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT" || !change.status.includes("D")) throw error;
      const baselineMode = await baselineModeForPath?.(change.path);
      if (baselineMode !== "100644" && baselineMode !== "100755") {
        throw new Error(
          `Dependency update deleted a symlink or special file: ${change.path}`,
        );
      }
    }
  }
}

async function baselineMode(
  repoRoot: string,
  baseline: RepositoryBaseline,
  path: string,
): Promise<string | undefined> {
  const output = await gitOutput(repoRoot, [
    "ls-tree",
    baseline.headSha,
    "--",
    path,
  ]);
  return /^(\d{6})\s/u.exec(output)?.[1];
}

async function assertTrustedChangeSet(
  repoRoot: string,
  baseline: RepositoryBaseline,
): Promise<void> {
  await assertRustDependencyUpdateChangeSet(
    repoRoot,
    await collectChangedPaths(repoRoot),
    (path) => baselineMode(repoRoot, baseline, path),
  );
}

export function assertNoPersistedGitCredentials(
  entries: readonly GitConfigEntry[],
): void {
  for (const entry of entries) {
    const key = entry.key.toLowerCase();
    const value = entry.value.toLowerCase();
    const keyOrValue = `${key}\n${value}`;
    const forbidden =
      (key.startsWith("http.") && key.endsWith(".extraheader")) ||
      key === "credential.helper" ||
      (key.startsWith("credential.") && key.endsWith(".helper")) ||
      keyOrValue.includes("authorization:") ||
      keyOrValue.includes("x-access-token") ||
      keyOrValue.includes("github_pat_") ||
      /https?:\/\/[^/\s]+@/u.test(keyOrValue);
    if (forbidden) {
      throw new Error(
        "Persisted Git publication credential detected in config",
      );
    }
  }
}

function parseGitConfig(output: string): GitConfigEntry[] {
  return parseNulSeparated(output).map((record) => {
    const separator = record.indexOf("\n");
    if (separator < 1) throw new Error("Malformed Git config record");
    return {
      key: record.slice(0, separator),
      value: record.slice(separator + 1),
    };
  });
}

async function assertCheckoutHasNoPersistedCredentials(
  repoRoot: string,
): Promise<void> {
  const config = await gitOutput(repoRoot, ["config", "--null", "--list"]);
  assertNoPersistedGitCredentials(parseGitConfig(config));
}

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
      env: createValidationEnvironment(hostEnvironment, validation.environment),
    });
  }
}

export async function validateThenPublish(
  validate: () => Promise<void>,
  publish: () => Promise<void>,
): Promise<void> {
  await validate();
  await publish();
}

type PublishedFixIdentity = {
  actualBaseRef: string;
  actualHeadRef: string;
  actualHeadSha: string;
  actualPrNumber: number;
  actualRemoteHeadSha: string;
  expectedBaseRef: string;
  expectedHeadRef: string;
  expectedHeadSha: string;
  expectedPrNumber: number;
};

export function assertPublishedFixIdentity(
  identity: PublishedFixIdentity,
): string {
  const mismatch = [
    ["PR number", identity.actualPrNumber, identity.expectedPrNumber],
    ["PR head ref", identity.actualHeadRef, identity.expectedHeadRef],
    ["PR head SHA", identity.actualHeadSha, identity.expectedHeadSha],
    [
      "remote branch SHA",
      identity.actualRemoteHeadSha,
      identity.expectedHeadSha,
    ],
    ["PR base", identity.actualBaseRef, identity.expectedBaseRef],
  ].find(([, actual, expected]) => actual !== expected);
  if (mismatch)
    throw new Error(
      `Published ${mismatch[0]} changed: expected ${mismatch[2]}, got ${mismatch[1]}`,
    );
  return identity.expectedHeadSha;
}

type PublishedPullRequest = {
  base: { ref: string };
  head: { ref: string; sha: string };
  number: number;
};

export async function verifyPublishedFix(args: {
  expectedBaseRef: string;
  expectedHeadRef: string;
  expectedHeadSha?: string;
  expectedPrNumber: number;
  fetchPullRequest: () => Promise<PublishedPullRequest>;
  fetchRemoteHeadSha: () => Promise<string>;
}): Promise<string> {
  const [pullRequest, remoteHeadSha] = await Promise.all([
    args.fetchPullRequest(),
    args.fetchRemoteHeadSha(),
  ]);
  return assertPublishedFixIdentity({
    actualBaseRef: pullRequest.base.ref,
    actualHeadRef: pullRequest.head.ref,
    actualHeadSha: pullRequest.head.sha,
    actualPrNumber: pullRequest.number,
    actualRemoteHeadSha: remoteHeadSha,
    expectedBaseRef: args.expectedBaseRef,
    expectedHeadRef: args.expectedHeadRef,
    expectedHeadSha: args.expectedHeadSha ?? remoteHeadSha,
    expectedPrNumber: args.expectedPrNumber,
  });
}

async function runValidationWithoutPublicationCredentials(
  repoRoot: string,
): Promise<void> {
  await withValidationEnvironment(process.env, (validationEnvironment) =>
    runRustDependencyUpdateValidation(repoRoot, validationEnvironment),
  );
}

async function verifyLiveFixPublication(args: {
  expectedHeadSha?: string;
  fixBranch: string;
  octokit: ReturnType<typeof createOctokit>;
  prNumber: number;
  repoRef: ReturnType<typeof parseRepository>;
}): Promise<string> {
  return verifyPublishedFix({
    expectedBaseRef: "main",
    expectedHeadRef: args.fixBranch,
    ...(args.expectedHeadSha ? { expectedHeadSha: args.expectedHeadSha } : {}),
    expectedPrNumber: args.prNumber,
    fetchPullRequest: async () => {
      const { data } = await args.octokit.rest.pulls.get({
        ...args.repoRef,
        pull_number: args.prNumber,
      });
      return data;
    },
    fetchRemoteHeadSha: async () => {
      const { data } = await args.octokit.rest.repos.getBranch({
        ...args.repoRef,
        branch: args.fixBranch,
      });
      return data.commit.sha;
    },
  });
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
    publishedHead = await verifyLiveFixPublication({
      fixBranch,
      octokit,
      prNumber,
      repoRef,
    });
    log.info(
      `Existing PR #${prNumber} exact head ${publishedHead} verified and handed to the continuing Gizmo owner`,
    );
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
    let baseline: RepositoryBaseline | undefined;
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      await assertCheckoutHasNoPersistedCredentials(repoRoot);
      baseline = await captureRepositoryBaseline(repoRoot);
    }

    const prompt = await loadPrompt(config);
    await runFixAgent(config, prompt, isolationForFixProfile(profile));

    if (baseline) await assertBaselineUnchanged(repoRoot, baseline);

    if (!(await hasWorkingTreeChanges(repoRoot))) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return undefined;
    }

    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      if (!baseline) {
        throw new Error("Rust dependency update baseline was not captured");
      }
      await validateThenPublish(
        async () => {
          await assertBaselineUnchanged(repoRoot, baseline);
          await assertTrustedChangeSet(repoRoot, baseline);
          await runValidationWithoutPublicationCredentials(repoRoot);
          await assertBaselineUnchanged(repoRoot, baseline);
          await assertTrustedChangeSet(repoRoot, baseline);
        },
        () => pushFixBranch(repoRoot, fixBranch, runId),
      );
    } else {
      await pushFixBranch(repoRoot, fixBranch, runId);
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
    publishedHead = await verifyLiveFixPublication({
      expectedHeadSha: localHead,
      fixBranch,
      octokit,
      prNumber,
      repoRef,
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
