import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
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
  trustedGitArgs,
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

export enum CiFixOutcomeKind {
  Published = "published",
  Skipped = "skipped",
}

enum RepositoryBaselineKind {
  Captured = "captured",
  NotRequired = "not-required",
}

type RepositoryBaselineState =
  | { kind: RepositoryBaselineKind.NotRequired }
  | { baseline: RepositoryBaseline; kind: RepositoryBaselineKind.Captured };
export const CI_FIX_SKIPPED = { kind: CiFixOutcomeKind.Skipped } as const;
export type PublishedCiFixOutcome = {
  headSha: string;
  kind: CiFixOutcomeKind.Published;
};
export type CiFixOutcome = typeof CI_FIX_SKIPPED | PublishedCiFixOutcome;

const VALIDATION_ENV_ALLOWLIST = new Set([
  "BUILDKIT_PROGRESS",
  "BUILDX_BUILDER",
  "CI",
  "DOCKER_BUILDKIT",
  "DOCKER_HOST",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "NOOK_ARC_HIVE",
  "NOOK_BUILDKIT_REMOTE",
  "NOOK_PR_BUILDX_BUILDER",
  "PATH",
  "RUNNER_TOOL_CACHE",
  "SHELL",
  "TERM",
  "TMPDIR",
]);

const NETWORKLESS_DOCKER = `#!/bin/sh
set -eu
real=\${NOOK_VALIDATION_DOCKER:?}
deny_net() { for a; do case "$a" in --network|--network=*|--net|--net=*) echo "Blocked Docker network override: $a" >&2; exit 97;; esac; done; }
case "\${1:-}" in
  build) shift; deny_net "$@"; exec "$real" build --network none "$@" ;;
  buildx)
    sub=\${2:-}; shift 2
    case "$sub" in
      bake) deny_net "$@"; exec "$real" buildx bake --set '*.network=none' "$@" ;;
      build) deny_net "$@"; exec "$real" buildx build --network none "$@" ;;
      create)
        [ "$*" = "--name \${NOOK_PR_BUILDX_BUILDER:-} --driver docker-container --bootstrap" ] || exit 97
        exec "$real" buildx create "$@" ;;
      inspect|use|version) exec "$real" buildx "$sub" "$@" ;;
      rm)
        [ "$*" = "--force \${NOOK_PR_BUILDX_BUILDER:-}" ] || exit 97
        exec "$real" buildx rm "$@" ;;
      *) echo "Blocked Docker buildx operation during isolated validation: $sub" >&2; exit 97 ;;
    esac ;;
  run) shift; deny_net "$@"; exec "$real" run --network none "$@" ;;
  container|cp|create|image|images|inspect|ps|rm|version) exec "$real" "$@" ;;
  *) echo "Blocked Docker operation during isolated validation: \${1:-<empty>}" >&2; exit 97 ;;
esac
`;

type ValidationCommand = {
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
};

export const RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS: readonly ValidationCommand[] =
  [
    {
      args: ["docker:ecosystem:fuzz", "FUZZ_SECONDS=20"],
      environment: {},
    },
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
  if (command !== "task")
    throw new Error("Isolated validation may only invoke task");
  const cwd = process.cwd();
  const hostEnvironment = { ...process.env };
  process.chdir(options.cwd);
  restoreHostEnvironment(options.env, process.env);
  try {
    if (
      args[0] !== "docker:ecosystem:fuzz" ||
      args[1] !== "FUZZ_SECONDS=20" ||
      args.length !== 2
    )
      throw new Error("Isolated validation command is not allowlisted");
    await new Promise<void>((resolveRun, rejectRun) => {
      const child = spawn(
        "task",
        ["docker:ecosystem:fuzz", "FUZZ_SECONDS=20"],
        { stdio: "inherit" },
      );
      child.once("error", rejectRun);
      child.once("close", (code, signal) => {
        if (code === 0 && !signal) resolveRun();
        else rejectRun(new Error("Isolated validation command failed"));
      });
    });
  } finally {
    restoreHostEnvironment(hostEnvironment, process.env);
    process.chdir(cwd);
  }
};

export type RepositoryBaseline = {
  headSha: string;
  indexTreeSha: string;
  gitMetadata: {
    commonDirectory: string;
    configuration: string;
    gitDirectory: string;
  };
};

type ChangedPath = {
  path: string;
  status: string;
};

type BaselineModeLookup = (path: string) => Promise<string>;

type GitConfigEntry = {
  key: string;
  value: string;
};

const RUST_DEPENDENCY_ROOTS = [
  "agentic-ai/minds/",
  "nook-app/nook-platform/",
  "preflight/",
] as const;

const CRATES_IO_SOURCE =
  "registry+https://github.com/rust-lang/crates.io-index";

function cargoLockSources(content: string): Set<string> {
  return new Set(
    [...content.matchAll(/^\s*source\s*=\s*["']([^"']+)["']/gmu)].map(
      (m) => m[1]!,
    ),
  );
}

function cargoTomlGitSources(content: string): Set<string> {
  return new Set(
    [...content.matchAll(/\bgit\s*=\s*["']([^"']+)["']/gu)].map((m) => m[1]!),
  );
}

export function assertCratesIoOnlySources(
  path: string,
  content: string,
  baseline = "",
): void {
  const introduced = path.endsWith("Cargo.lock")
    ? [...cargoLockSources(content)].filter(
        (source) =>
          source !== CRATES_IO_SOURCE && !cargoLockSources(baseline).has(source),
      )
    : path.endsWith("Cargo.toml")
      ? [...cargoTomlGitSources(content)].filter(
          (source) => !cargoTomlGitSources(baseline).has(source),
        )
      : [];
  if (introduced.length > 0)
    throw new Error(`Dependency update used a non-crates.io source: ${path}`);
}

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
  return (
    await execFileAsync("git", trustedGitArgs(repoRoot, args), {
      encoding: "utf8",
    })
  ).stdout;
}

async function currentIndexTree(repoRoot: string): Promise<string> {
  return (await gitOutput(repoRoot, ["write-tree"])).trim();
}

export async function captureGitMetadataBaseline(
  repoRoot: string,
): Promise<RepositoryBaseline["gitMetadata"]> {
  const [commonDirectory, configuration, gitDirectory] = await Promise.all([
    gitOutput(repoRoot, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
    gitOutput(repoRoot, [
      "config",
      "--null",
      "--show-origin",
      "--show-scope",
      "--list",
    ]),
    gitOutput(repoRoot, ["rev-parse", "--absolute-git-dir"]),
  ]);
  const gitDir = gitDirectory.trim();
  let exclude = "";
  try {
    exclude = await readFile(join(gitDir, "info", "exclude"), "utf8");
  } catch {
    exclude = "";
  }
  return {
    commonDirectory: commonDirectory.trim(),
    configuration: `${configuration}\0${exclude}`,
    gitDirectory: gitDir,
  };
}

export function assertGitMetadataBaselineUnchanged(args: {
  baseline: RepositoryBaseline["gitMetadata"];
  current: RepositoryBaseline["gitMetadata"];
}): void {
  if (
    args.current.commonDirectory !== args.baseline.commonDirectory ||
    args.current.gitDirectory !== args.baseline.gitDirectory ||
    args.current.configuration !== args.baseline.configuration
  ) {
    throw new Error("Bounded editor changed trusted Git metadata");
  }
}

export async function captureRepositoryBaseline(
  repoRoot: string,
): Promise<RepositoryBaseline> {
  const [headSha, headTreeSha, indexTreeSha] = await Promise.all([
    revParse(repoRoot, "HEAD"),
    revParse(repoRoot, "HEAD^{tree}"),
    currentIndexTree(repoRoot),
  ]);
  if (
    indexTreeSha !== headTreeSha ||
    (await collectChangedPaths(repoRoot)).length !== 0
  )
    throw new Error("Trusted dependency-update baseline checkout is not clean");
  return {
    gitMetadata: await captureGitMetadataBaseline(repoRoot),
    headSha,
    indexTreeSha,
  };
}

export function assertRepositoryBaselineUnchanged(args: {
  baseline: Pick<RepositoryBaseline, "headSha" | "indexTreeSha">;
  currentHeadSha: string;
  currentIndexTreeSha: string;
}): void {
  const changed =
    args.currentHeadSha !== args.baseline.headSha
      ? "HEAD"
      : args.currentIndexTreeSha !== args.baseline.indexTreeSha
        ? "index"
        : "";
  if (changed)
    throw new Error(`Bounded editor changed the trusted baseline ${changed}`);
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
  assertGitMetadataBaselineUnchanged({
    baseline: baseline.gitMetadata,
    current: await captureGitMetadataBaseline(repoRoot),
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
  baselineModeForPath: BaselineModeLookup = async () => "",
  baselineContentForPath: (path: string) => Promise<string> = async () => "",
): Promise<void> {
  if (changes.length === 0)
    throw new Error("Trusted dependency-update change set is empty");
  const root = resolve(repoRoot);
  for (const change of changes) {
    if (change.path.startsWith("/") || change.path.split("/").includes(".."))
      throw new Error("Dependency-update path escapes the repository");
    if (isOrchestrationControlPath(change.path))
      throw new Error(
        `Dependency update changed trusted orchestration control: ${change.path}`,
      );
    if (!isAllowedRustDependencyPath(change.path))
      throw new Error(
        `Dependency update changed forbidden path: ${change.path}`,
      );
    const absolutePath = resolve(root, change.path);
    if (!absolutePath.startsWith(`${root}${sep}`))
      throw new Error("Dependency-update path escapes the repository");
    try {
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile()) {
        throw new Error(
          `Dependency update produced a symlink or special file: ${change.path}`,
        );
      }
      if (
        change.path.endsWith("Cargo.toml") ||
        change.path.endsWith("Cargo.lock")
      )
        assertCratesIoOnlySources(
          change.path,
          await readFile(absolutePath, "utf8"),
          await baselineContentForPath(change.path),
        );
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT" || !change.status.includes("D")) throw error;
      const baselineMode = await baselineModeForPath(change.path);
      if (baselineMode !== "100644" && baselineMode !== "100755") {
        throw new Error(
          `Dependency update deleted a symlink or special file: ${change.path}`,
        );
      }
    }
  }
}

async function gitShow(repoRoot: string, spec: string): Promise<string> {
  try {
    return await gitOutput(repoRoot, ["show", spec]);
  } catch {
    return "";
  }
}

async function collectCommittedChangeSet(
  repoRoot: string,
  base: string,
): Promise<ChangedPath[]> {
  const records = parseNulSeparated(
    await gitOutput(repoRoot, ["diff", "-z", "--name-status", base]),
  );
  const changes: ChangedPath[] = [];
  for (let index = 0; index < records.length; ) {
    const status = records[index]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      changes.push(
        { path: records[index + 2]!, status },
        { path: records[index + 1]!, status },
      );
      index += 3;
    } else {
      changes.push({ path: records[index + 1]!, status: status.padEnd(2, " ") });
      index += 2;
    }
  }
  return changes;
}

async function assertTrustedChangeSet(
  repoRoot: string,
  baseline: string,
  changes: readonly ChangedPath[],
): Promise<void> {
  await assertRustDependencyUpdateChangeSet(
    repoRoot,
    changes,
    async (path) => {
      const match = /^(\d{6})\s/u.exec(
        await gitOutput(repoRoot, ["ls-tree", baseline, "--", path]),
      );
      return match ? match[1] || "" : "";
    },
    async (path) => gitShow(repoRoot, `${baseline}:${path}`),
  );
}

export function assertNoPersistedGitCredentials(
  entries: readonly GitConfigEntry[],
): void {
  const forbidden = entries.some((entry) => {
    const key = entry.key.toLowerCase();
    const keyOrValue = `${key}\n${entry.value.toLowerCase()}`;
    return (
      (key.startsWith("http.") && key.endsWith(".extraheader")) ||
      key === "credential.helper" ||
      (key.startsWith("credential.") && key.endsWith(".helper")) ||
      keyOrValue.includes("authorization:") ||
      keyOrValue.includes("x-access-token") ||
      keyOrValue.includes("github_pat_") ||
      /https?:\/\/[^/\s]+@/u.test(keyOrValue)
    );
  });
  if (forbidden)
    throw new Error("Persisted Git publication credential detected in config");
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

export function resolveCiAgentFixProfile(value = ""): CiAgentFixProfile {
  const profile = value.trim();
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
    ? AgentIsolation["Strict"]
    : AgentIsolation.Legacy;
}

export function createValidationEnvironment(
  hostEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of VALIDATION_ENV_ALLOWLIST) {
    const value = hostEnvironment[name];
    if (typeof value === "string") environment[name] = value;
  }
  return environment;
}

export async function withValidationEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  operation: (sanitized: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const hostEnvironment = { ...environment };
  const isolatedRoot = await mkdtemp(join(tmpdir(), "nook-validation-"));
  try {
    const base = createValidationEnvironment(hostEnvironment);
    let dockerHost = "";
    for (const dir of (base.PATH ?? "").split(":")) {
      try {
        await lstat(join(dir, "docker"));
        dockerHost = join(dir, "docker");
        break;
      } catch {
        continue;
      }
    }
    if (!dockerHost) throw new Error("docker not found on sanitized PATH");
    const bin = join(isolatedRoot, "bin");
    const home = join(isolatedRoot, "home");
    const docker = join(bin, "docker");
    await Promise.all([mkdir(bin), mkdir(home)]);
    await writeFile(docker, NETWORKLESS_DOCKER, { mode: 0o700 });
    const builder = base.NOOK_PR_BUILDX_BUILDER;
    const hostHome = environment.HOME;
    if (builder) {
      if (!/^[a-zA-Z0-9_.-]+$/u.test(builder) || !hostHome)
        throw new Error("Invalid trusted Buildx instance metadata");
      const buildx = join(hostHome, ".docker", "buildx");
      const source = join(buildx, "instances", builder);
      if (!(await lstat(source)).isFile())
        throw new Error(
          "Trusted Buildx instance metadata is not a regular file",
        );
      const instances = join(home, ".docker", "buildx", "instances");
      await mkdir(instances, { recursive: true });
      await copyFile(source, join(instances, builder));
    }
    restoreHostEnvironment(
      {
        ...base,
        DOCKER: docker,
        HOME: home,
        NOOK_VALIDATION_DOCKER: dockerHost,
        PATH: `${bin}:${base.PATH || ""}`,
        SCCACHE_OPTIONAL: "1",
        ...(builder ? { BUILDX_BUILDER: builder } : {}),
      },
      environment,
    );
    return await operation(environment);
  } finally {
    restoreHostEnvironment(hostEnvironment, environment);
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

export async function runRustDependencyUpdateValidation(
  repoRoot: string,
  sanitizedEnvironment: NodeJS.ProcessEnv,
  runner: ValidationRunner = runValidationCommand,
): Promise<void> {
  for (const validation of RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS) {
    await runner("task", validation.args, {
      cwd: repoRoot,
      env: { ...sanitizedEnvironment, ...validation.environment },
    });
  }
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
  expectedHeadSha: string;
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
    expectedHeadSha: args.expectedHeadSha,
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
  expectedHeadSha: string;
  fixBranch: string;
  octokit: ReturnType<typeof createOctokit>;
  prNumber: number;
  repoRef: ReturnType<typeof parseRepository>;
}): Promise<PublishedCiFixOutcome> {
  return {
    headSha: await verifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: args.fixBranch,
      expectedHeadSha: args.expectedHeadSha,
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
    }),
    kind: CiFixOutcomeKind.Published,
  };
}

export async function runCiFix(): Promise<CiFixOutcome> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }

  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const fixBranch = process.env.FIX_BRANCH?.trim() || `fix/ci-${runId}`;
  const profile = resolveCiAgentFixProfile(
    process.env.CI_AGENT_FIX_PROFILE || "",
  );
  chdir(repoRoot);

  const octokit = createOctokit();
  await configureGitForCi(repoRoot, octokit);
  const repoRef = parseRepository(repository);

  let openPr = await findOpenPr(octokit, repoRef, fixBranch);
  let prNumber: number;
  let outcome: CiFixOutcome;
  if (openPr.kind === OpenPrLookupKind.Found) {
    prNumber = openPr.number;
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      const token = process.env.NOOK_GITHUB_PAT?.trim();
      const priorCount = process.env.GIT_CONFIG_COUNT ?? "";
      const priorKey = process.env.GIT_CONFIG_KEY_0 ?? "";
      const priorValue = process.env.GIT_CONFIG_VALUE_0 ?? "";
      const hadCount = Object.hasOwn(process.env, "GIT_CONFIG_COUNT");
      const hadKey = Object.hasOwn(process.env, "GIT_CONFIG_KEY_0");
      const hadValue = Object.hasOwn(process.env, "GIT_CONFIG_VALUE_0");
      if (token) {
        process.env.GIT_CONFIG_COUNT = "1";
        process.env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
        process.env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
      }
      try {
        await gitOutput(repoRoot, [
          "fetch",
          "--depth=1",
          "origin",
          "main",
          fixBranch,
        ]);
      } finally {
        if (hadCount) process.env.GIT_CONFIG_COUNT = priorCount;
        else delete process.env.GIT_CONFIG_COUNT;
        if (hadKey) process.env.GIT_CONFIG_KEY_0 = priorKey;
        else delete process.env.GIT_CONFIG_KEY_0;
        if (hadValue) process.env.GIT_CONFIG_VALUE_0 = priorValue;
        else delete process.env.GIT_CONFIG_VALUE_0;
      }
      await gitOutput(repoRoot, [
        "checkout",
        "--force",
        `origin/${fixBranch}`,
      ]);
      await assertTrustedChangeSet(
        repoRoot,
        "origin/main",
        await collectCommittedChangeSet(repoRoot, "origin/main"),
      );
      await runValidationWithoutPublicationCredentials(repoRoot);
    }
    outcome = await verifyLiveFixPublication({
      expectedHeadSha: await revParse(repoRoot, "HEAD"),
      fixBranch,
      octokit,
      prNumber,
      repoRef,
    });
    log.info(
      `Existing PR #${prNumber} exact head ${outcome.headSha} verified and handed to the continuing Gizmo owner`,
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
      return CI_FIX_SKIPPED;
    }

    const loadedConfig = loadConfig();
    if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
      return CI_FIX_SKIPPED;
    }
    const config = loadedConfig.config;
    let baselineState: RepositoryBaselineState = {
      kind: RepositoryBaselineKind.NotRequired,
    };
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      await assertCheckoutHasNoPersistedCredentials(repoRoot);
      baselineState = {
        baseline: await captureRepositoryBaseline(repoRoot),
        kind: RepositoryBaselineKind.Captured,
      };
    }

    const prompt = await loadPrompt(config);
    await runFixAgent(config, prompt, isolationForFixProfile(profile));

    if (baselineState.kind === RepositoryBaselineKind.Captured)
      await assertBaselineUnchanged(repoRoot, baselineState.baseline);

    if (!(await hasWorkingTreeChanges(repoRoot))) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return CI_FIX_SKIPPED;
    }

    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      if (baselineState.kind !== RepositoryBaselineKind.Captured) {
        throw new Error("Rust dependency update baseline was not captured");
      }
      const { baseline } = baselineState;
      const scoped = async () =>
        assertTrustedChangeSet(
          repoRoot,
          baseline.headSha,
          await collectChangedPaths(repoRoot),
        );
      await assertBaselineUnchanged(repoRoot, baseline);
      await scoped();
      await runValidationWithoutPublicationCredentials(repoRoot);
      await assertBaselineUnchanged(repoRoot, baseline);
      await scoped();
      await pushFixBranch(repoRoot, fixBranch, runId);
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
    outcome = await verifyLiveFixPublication({
      expectedHeadSha: localHead,
      fixBranch,
      octokit,
      prNumber,
      repoRef,
    });
    log.info(
      `PR #${prNumber} exact head ${outcome.headSha} verified and handed to the continuing Gizmo owner`,
    );
  }

  const fixLabel = process.env.CI_FIX_LABEL?.trim() || "main CI";
  log.info(
    `PR #${prNumber} is open without automatic merge; ${fixLabel} run ${runId} requires explicit merge authorization`,
  );
  return outcome;
}
