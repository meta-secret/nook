import {
  DependencyFixAssertGitMetadataBaselineUnchanged,
  DependencyFixAssertRepositoryBaselineUnchanged,
} from "./repository-baseline.js";
export {
  DependencyFixAssertGitMetadataBaselineUnchanged,
  DependencyFixAssertRepositoryBaselineUnchanged,
} from "./repository-baseline.js";
import {
  NulSeparatedRecords,
  GitConfiguration,
  GitConfigurationText,
  type GitConfigEntry,
} from "./git-configuration.js";
export { GitConfiguration } from "./git-configuration.js";
import {
  RustDependencyDocument,
  RustDependencyPath,
} from "./rust-dependency-document.js";
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

import { CiAgentConfigLoadKind, CiAgentEnvironment } from "./config.js";
import {
  GitHubClient,
  GitHubEnvironment,
  OpenPrLookupKind,
  GitHubRepositoryName,
} from "./github.js";
import { CiRepository } from "./git.js";
import { Logger } from "./logger.js";
import { AgentPrompt } from "./prompt.js";
import {
  AgentIsolation,
  AgentRuntimeRestoreHostEnvironment,
  ConfiguredAgentRuntime,
} from "./run-agent.js";
export class CiFixCommand {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  async runCiFix(): Promise<CiFixOutcome> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim();
    const runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId) {
      throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
    }

    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const fixBranch = this.environment.FIX_BRANCH?.trim() || `fix/ci-${runId}`;
    const profile = new CiFixProfileName(
      this.environment.CI_AGENT_FIX_PROFILE || "",
    ).parse();
    chdir(repoRoot);

    const octokit = new GitHubEnvironment(process.env).createOctokit();
    await new CiRepository(repoRoot).configureGitForCi({ octokit: octokit });
    const repoRef = new GitHubRepositoryName(repository).parse();

    let openPr = await new GitHubClient(octokit).findOpenPr({
      subject1: repoRef,
      headBranch: fixBranch,
    });
    let prNumber: number;
    let outcome: CiFixOutcome;
    if (openPr.kind === OpenPrLookupKind.Found) {
      prNumber = openPr.number;
      if (profile === CiAgentFixProfile.RustDependencyUpdate) {
        const token = this.environment.NOOK_GITHUB_PAT?.trim();
        const [priorCount = ""] = [this.environment.GIT_CONFIG_COUNT];
        const [priorKey = ""] = [this.environment.GIT_CONFIG_KEY_0];
        const [priorValue = ""] = [this.environment.GIT_CONFIG_VALUE_0];
        const hadCount = Object.hasOwn(this.environment, "GIT_CONFIG_COUNT");
        const hadKey = Object.hasOwn(this.environment, "GIT_CONFIG_KEY_0");
        const hadValue = Object.hasOwn(this.environment, "GIT_CONFIG_VALUE_0");
        if (token) {
          this.environment.GIT_CONFIG_COUNT = "1";
          this.environment.GIT_CONFIG_KEY_0 =
            "http.https://github.com/.extraheader";
          this.environment.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
        }
        try {
          await new DependencyFixRepository(repoRoot).gitOutput({
            args: ["fetch", "--depth=1", "origin", "main", fixBranch],
          });
        } finally {
          if (hadCount) this.environment.GIT_CONFIG_COUNT = priorCount;
          else delete this.environment.GIT_CONFIG_COUNT;
          if (hadKey) this.environment.GIT_CONFIG_KEY_0 = priorKey;
          else delete this.environment.GIT_CONFIG_KEY_0;
          if (hadValue) this.environment.GIT_CONFIG_VALUE_0 = priorValue;
          else delete this.environment.GIT_CONFIG_VALUE_0;
        }
        await new DependencyFixRepository(repoRoot).gitOutput({
          args: ["checkout", "--force", `origin/${fixBranch}`],
        });
        const auditedBase = (
          await new DependencyFixRepository(repoRoot).gitOutput({
            args: ["merge-base", "origin/main", "HEAD"],
          })
        ).trim();
        await new DependencyFixRepository(repoRoot).assertTrustedChangeSet({
          baseline: auditedBase,
          changes: await new DependencyFixRepository(
            repoRoot,
          ).collectCommittedChangeSet({ base: auditedBase }),
        });
        await new DependencyFixRepository(
          repoRoot,
        ).runValidationWithoutPublicationCredentials();
      }
      outcome = await new DependencyFixVerifyLiveFixPublication({
        expectedHeadSha: await new CiRepository(repoRoot).revParse({
          ref: "HEAD",
        }),
        fixBranch,
        octokit,
        prNumber,
        repoRef,
      }).execute();
      log.info(
        `Existing PR #${prNumber} exact head ${outcome.headSha} verified and handed to the continuing Gizmo owner`,
      );
    } else {
      const cursorApiKey = this.environment.CURSOR_API_KEY?.trim();
      if (!cursorApiKey) {
        console.log(
          "::warning::CURSOR_API_KEY is not set — skipping AI CI fix job.",
        );
        console.log(
          "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys).",
        );
        return CI_FIX_SKIPPED;
      }

      const loadedConfig = new CiAgentEnvironment(process.env).loadConfig();
      if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
        return CI_FIX_SKIPPED;
      }
      const config = loadedConfig.config;
      let baselineState: RepositoryBaselineState = {
        kind: RepositoryBaselineKind.NotRequired,
      };
      if (profile === CiAgentFixProfile.RustDependencyUpdate) {
        await new DependencyFixRepository(
          repoRoot,
        ).assertCheckoutHasNoPersistedCredentials();
        baselineState = {
          baseline: await new DependencyFixRepository(
            repoRoot,
          ).captureRepositoryBaseline(),
          kind: RepositoryBaselineKind.Captured,
        };
      }

      const prompt = await new AgentPrompt(config).load();
      await new ConfiguredAgentRuntime(config).runFixAgent({
        prompt: prompt,
        isolation: new DependencyFixIsolationForFixProfile(profile).execute(),
      });

      if (baselineState.kind === RepositoryBaselineKind.Captured)
        await new DependencyFixRepository(repoRoot).assertBaselineUnchanged({
          baseline: baselineState.baseline,
        });

      if (!(await new CiRepository(repoRoot).hasWorkingTreeChanges())) {
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
          new DependencyFixRepository(repoRoot).assertTrustedChangeSet({
            baseline: baseline.headSha,
            changes: await new DependencyFixRepository(
              repoRoot,
            ).collectChangedPaths(),
          });
        await new DependencyFixRepository(repoRoot).assertBaselineUnchanged({
          baseline: baseline,
        });
        await scoped();
        await new DependencyFixRepository(
          repoRoot,
        ).runValidationWithoutPublicationCredentials();
        await new DependencyFixRepository(repoRoot).assertBaselineUnchanged({
          baseline: baseline,
        });
        await scoped();
        await new CiRepository(repoRoot).pushFixBranch({
          fixBranch: fixBranch,
          runId: runId,
        });
      } else {
        await new CiRepository(repoRoot).pushFixBranch({
          fixBranch: fixBranch,
          runId: runId,
        });
      }

      openPr = await new GitHubClient(octokit).findOpenPr({
        subject1: repoRef,
        headBranch: fixBranch,
      });
      if (openPr.kind === OpenPrLookupKind.Found) {
        prNumber = openPr.number;
      } else {
        prNumber = await new GitHubClient(octokit).createFixPr({
          repoRef: repoRef,
          headBranch: fixBranch,
          runId: runId,
          fixLabel: config.fixLabel,
          baseBranch: "main",
        });
      }
      const localHead = await new CiRepository(repoRoot).revParse({
        ref: "HEAD",
      });
      outcome = await new DependencyFixVerifyLiveFixPublication({
        expectedHeadSha: localHead,
        fixBranch,
        octokit,
        prNumber,
        repoRef,
      }).execute();
      log.info(
        `PR #${prNumber} exact head ${outcome.headSha} verified and handed to the continuing Gizmo owner`,
      );
    }

    const fixLabel = this.environment.CI_FIX_LABEL?.trim() || "main CI";
    log.info(
      `PR #${prNumber} is open without automatic merge; ${fixLabel} run ${runId} requires explicit merge authorization`,
    );
    return outcome;
  }
}

export interface DependencyFixRepositoryGitOutputRequest {
  readonly args: string[];
}

export interface DependencyFixRepositoryAssertBaselineUnchangedRequest {
  readonly baseline: RepositoryBaseline;
}

export interface DependencyFixRepositoryAssertRustDependencyUpdateChangeSetRequest {
  readonly changes: readonly ChangedPath[];
  readonly baselineModeForPath?: BaselineModeLookup;
  readonly baselineContentForPath?: (path: string) => Promise<string>;
}

export interface DependencyFixRepositoryGitShowRequest {
  readonly spec: string;
}

export interface DependencyFixRepositoryCollectCommittedChangeSetRequest {
  readonly base: string;
}

export interface DependencyFixRepositoryAssertTrustedChangeSetRequest {
  readonly baseline: string;
  readonly changes: readonly ChangedPath[];
}

export interface DependencyFixRepositoryRunRustDependencyUpdateValidationRequest {
  readonly sanitizedEnvironment: NodeJS.ProcessEnv;
  readonly runner?: ValidationRunner;
}

export class DependencyFixRepository {
  constructor(private readonly value: string) {}
  async gitOutput(
    request: DependencyFixRepositoryGitOutputRequest,
  ): Promise<string> {
    const repoRoot = this.value;
    const { args } = request;

    return (
      await execFileAsync(
        "git",
        new CiRepository(repoRoot).trustedGitArgs({ args: args }),
        {
          encoding: "utf8",
        },
      )
    ).stdout;
  }

  async currentIndexTree(): Promise<string> {
    const repoRoot = this.value;

    return (
      await new DependencyFixRepository(repoRoot).gitOutput({
        args: ["write-tree"],
      })
    ).trim();
  }

  async captureGitMetadataBaseline(): Promise<
    RepositoryBaseline["gitMetadata"]
  > {
    const repoRoot = this.value;

    const [commonDirectory, configuration, gitDirectory] = await Promise.all([
      new DependencyFixRepository(repoRoot).gitOutput({
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      }),
      new DependencyFixRepository(repoRoot).gitOutput({
        args: ["config", "--null", "--show-origin", "--show-scope", "--list"],
      }),
      new DependencyFixRepository(repoRoot).gitOutput({
        args: ["rev-parse", "--absolute-git-dir"],
      }),
    ]);
    const gitDir = gitDirectory.trim();
    let exclude = "";
    try {
      exclude = await readFile(join(gitDir, "info", "exclude"), "utf8");
    } catch {
      exclude = "";
    }
    const indexFlags = await new DependencyFixRepository(repoRoot).gitOutput({
      args: ["ls-files", "-v"],
    });
    if (
      indexFlags
        .split("\n")
        .some((line) => line.startsWith("S") || line.startsWith("h"))
    )
      throw new Error("Bounded editor set nondefault Git index flags");
    return {
      commonDirectory: commonDirectory.trim(),
      configuration: `${configuration}\0${exclude}\0${indexFlags}`,
      gitDirectory: gitDir,
    };
  }

  async captureRepositoryBaseline(): Promise<RepositoryBaseline> {
    const repoRoot = this.value;

    const [headSha, headTreeSha, indexTreeSha] = await Promise.all([
      new CiRepository(repoRoot).revParse({ ref: "HEAD" }),
      new CiRepository(repoRoot).revParse({ ref: "HEAD^{tree}" }),
      new DependencyFixRepository(repoRoot).currentIndexTree(),
    ]);
    if (
      indexTreeSha !== headTreeSha ||
      (await new DependencyFixRepository(repoRoot).collectChangedPaths())
        .length !== 0
    )
      throw new Error(
        "Trusted dependency-update baseline checkout is not clean",
      );
    return {
      gitMetadata: await new DependencyFixRepository(
        repoRoot,
      ).captureGitMetadataBaseline(),
      headSha,
      indexTreeSha,
    };
  }

  async assertBaselineUnchanged(
    request: DependencyFixRepositoryAssertBaselineUnchangedRequest,
  ): Promise<void> {
    const repoRoot = this.value;
    const { baseline } = request;

    new DependencyFixAssertRepositoryBaselineUnchanged({
      baseline,
      currentHeadSha: await new CiRepository(repoRoot).revParse({
        ref: "HEAD",
      }),
      currentIndexTreeSha: await new DependencyFixRepository(
        repoRoot,
      ).currentIndexTree(),
    }).execute();
    new DependencyFixAssertGitMetadataBaselineUnchanged({
      baseline: baseline.gitMetadata,
      current: await new DependencyFixRepository(
        repoRoot,
      ).captureGitMetadataBaseline(),
    }).execute();
  }

  async collectChangedPaths(): Promise<ChangedPath[]> {
    const repoRoot = this.value;

    const status = await new DependencyFixRepository(repoRoot).gitOutput({
      args: [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ".",
      ],
    });
    return new DependencyFixParsePorcelainStatus(status).execute();
  }

  async assertRustDependencyUpdateChangeSet(
    request: DependencyFixRepositoryAssertRustDependencyUpdateChangeSetRequest,
  ): Promise<void> {
    const repoRoot = this.value;
    const {
      changes,
      baselineModeForPath = async () => "",
      baselineContentForPath = async () => "",
    } = request;

    if (changes.length === 0)
      throw new Error("Trusted dependency-update change set is empty");
    const root = resolve(repoRoot);
    for (const change of changes) {
      if (change.path.startsWith("/") || change.path.split("/").includes(".."))
        throw new Error("Dependency-update path escapes the repository");
      if (new RustDependencyPath(change.path).isOrchestrationControl())
        throw new Error(
          `Dependency update changed trusted orchestration control: ${change.path}`,
        );
      if (!new RustDependencyPath(change.path).isAllowed())
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
          new RustDependencyDocument({
            path: change.path,
            content: await readFile(absolutePath, "utf8"),
            baseline: await baselineContentForPath(change.path),
          }).validateSources();
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

  async gitShow(
    request: DependencyFixRepositoryGitShowRequest,
  ): Promise<string> {
    const repoRoot = this.value;
    const { spec } = request;

    try {
      return await new DependencyFixRepository(repoRoot).gitOutput({
        args: ["show", spec],
      });
    } catch {
      return "";
    }
  }

  async collectCommittedChangeSet(
    request: DependencyFixRepositoryCollectCommittedChangeSetRequest,
  ): Promise<ChangedPath[]> {
    const repoRoot = this.value;
    const { base } = request;

    const records = new NulSeparatedRecords(
      await new DependencyFixRepository(repoRoot).gitOutput({
        args: ["diff", "-z", "--name-status", base],
      }),
    ).values();
    const changes: ChangedPath[] = [];
    for (let index = 0; index < records.length;) {
      const status = records[index]!;
      if (status.startsWith("R") || status.startsWith("C")) {
        changes.push(
          { path: records[index + 2]!, status },
          { path: records[index + 1]!, status },
        );
        index += 3;
      } else {
        changes.push({
          path: records[index + 1]!,
          status: status.padEnd(2, " "),
        });
        index += 2;
      }
    }
    return changes;
  }

  async assertTrustedChangeSet(
    request: DependencyFixRepositoryAssertTrustedChangeSetRequest,
  ): Promise<void> {
    const repoRoot = this.value;
    const { baseline, changes } = request;

    await new DependencyFixRepository(
      repoRoot,
    ).assertRustDependencyUpdateChangeSet({
      changes: changes,
      baselineModeForPath: async (path) => {
        const match = /^(\d{6})\s/u.exec(
          await new DependencyFixRepository(repoRoot).gitOutput({
            args: ["ls-tree", baseline, "--", path],
          }),
        );
        return match ? match[1] || "" : "";
      },
      baselineContentForPath: async (path) =>
        new DependencyFixRepository(repoRoot).gitShow({
          spec: `${baseline}:${path}`,
        }),
    });
  }

  async assertCheckoutHasNoPersistedCredentials(): Promise<void> {
    const repoRoot = this.value;

    const config = await new DependencyFixRepository(repoRoot).gitOutput({
      args: ["config", "--null", "--list"],
    });
    new GitConfiguration(
      new GitConfigurationText(config).decode(),
    ).assertCredentialFree();
  }

  async runRustDependencyUpdateValidation(
    request: DependencyFixRepositoryRunRustDependencyUpdateValidationRequest,
  ): Promise<void> {
    const repoRoot = this.value;
    const { sanitizedEnvironment, runner = runValidationCommand } = request;

    for (const validation of RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS) {
      await runner("task", validation.args, {
        cwd: repoRoot,
        env: { ...sanitizedEnvironment, ...validation.environment },
      });
    }
  }

  async runValidationWithoutPublicationCredentials(): Promise<void> {
    const repoRoot = this.value;

    await new DependencyFixWithValidationEnvironment({
      environment: process.env,
      operation: (validationEnvironment) =>
        new DependencyFixRepository(repoRoot).runRustDependencyUpdateValidation(
          { sanitizedEnvironment: validationEnvironment },
        ),
    }).execute();
  }
}

export class DependencyFixParsePorcelainStatus {
  constructor(private readonly request: string) {}
  execute(): ChangedPath[] {
    const output = this.request;

    const records = new NulSeparatedRecords(output).values();
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
}

export class DependencyFixIsolationForFixProfile {
  constructor(private readonly request: CiAgentFixProfile) {}
  execute(): AgentIsolation {
    const profile = this.request;

    return profile === CiAgentFixProfile.RustDependencyUpdate
      ? AgentIsolation["Strict"]
      : AgentIsolation.Legacy;
  }
}

export class DependencyFixCreateValidationEnvironment {
  constructor(private readonly request: NodeJS.ProcessEnv) {}
  execute(): NodeJS.ProcessEnv {
    const hostEnvironment = this.request;

    const environment: NodeJS.ProcessEnv = {};
    for (const name of VALIDATION_ENV_ALLOWLIST) {
      const value = hostEnvironment[name];
      if (typeof value === "string") environment[name] = value;
    }
    return environment;
  }
}

export interface DependencyFixWithValidationEnvironmentRequest<T> {
  readonly environment: NodeJS.ProcessEnv;
  readonly operation: (sanitized: NodeJS.ProcessEnv) => Promise<T>;
}

export class DependencyFixWithValidationEnvironment<T> {
  constructor(
    private readonly request: DependencyFixWithValidationEnvironmentRequest<T>,
  ) {}
  async execute(): Promise<T> {
    const { environment, operation } = this.request;

    const hostEnvironment = { ...environment };
    const isolatedRoot = await mkdtemp(join(tmpdir(), "nook-validation-"));
    try {
      const base = new DependencyFixCreateValidationEnvironment(
        hostEnvironment,
      ).execute();
      let dockerHost = "";
      const [defaulted1 = ""] = [base.PATH];
      for (const dir of defaulted1.split(":")) {
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
      new AgentRuntimeRestoreHostEnvironment({
        snapshot: {
          ...base,
          DOCKER: docker,
          HOME: home,
          NOOK_VALIDATION_DOCKER: dockerHost,
          PATH: `${bin}:${base.PATH || ""}`,
          SCCACHE_OPTIONAL: "1",
          ...(builder ? { BUILDX_BUILDER: builder } : {}),
        },
        environment: environment,
      }).execute();
      return await operation(environment);
    } finally {
      new AgentRuntimeRestoreHostEnvironment({
        snapshot: hostEnvironment,
        environment: environment,
      }).execute();
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  }
}

export class DependencyFixAssertPublishedFixIdentity {
  constructor(private readonly request: PublishedFixIdentity) {}
  execute(): string {
    const identity = this.request;

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
}

export class DependencyFixVerifyPublishedFix {
  constructor(
    private readonly request: {
      expectedBaseRef: string;
      expectedHeadRef: string;
      expectedHeadSha: string;
      expectedPrNumber: number;
      fetchPullRequest: () => Promise<PublishedPullRequest>;
      fetchRemoteHeadSha: () => Promise<string>;
    },
  ) {}
  async execute(): Promise<string> {
    const args = this.request;

    const [pullRequest, remoteHeadSha] = await Promise.all([
      args.fetchPullRequest(),
      args.fetchRemoteHeadSha(),
    ]);
    return new DependencyFixAssertPublishedFixIdentity({
      actualBaseRef: pullRequest.base.ref,
      actualHeadRef: pullRequest.head.ref,
      actualHeadSha: pullRequest.head.sha,
      actualPrNumber: pullRequest.number,
      actualRemoteHeadSha: remoteHeadSha,
      expectedBaseRef: args.expectedBaseRef,
      expectedHeadRef: args.expectedHeadRef,
      expectedHeadSha: args.expectedHeadSha,
      expectedPrNumber: args.expectedPrNumber,
    }).execute();
  }
}

class DependencyFixVerifyLiveFixPublication {
  constructor(
    private readonly request: {
      expectedHeadSha: string;
      fixBranch: string;
      octokit: ReturnType<GitHubEnvironment["createOctokit"]>;
      prNumber: number;
      repoRef: ReturnType<GitHubRepositoryName["parse"]>;
    },
  ) {}
  async execute(): Promise<PublishedCiFixOutcome> {
    const args = this.request;

    return {
      headSha: await new DependencyFixVerifyPublishedFix({
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
      }).execute(),
      kind: CiFixOutcomeKind.Published,
    };
  }
}

const log = new Logger("fix");
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
  if (command !== "task")
    throw new Error("Isolated validation may only invoke task");
  const cwd = process.cwd();
  const hostEnvironment = { ...process.env };
  process.chdir(options.cwd);
  new AgentRuntimeRestoreHostEnvironment({
    snapshot: options.env,
    environment: process.env,
  }).execute();
  try {
    const wait = (fuzz: boolean) =>
      new Promise<void>((resolveRun, rejectRun) => {
        const child = fuzz
          ? spawn("task", ["docker:ecosystem:fuzz", "FUZZ_SECONDS=20"], {
              stdio: "inherit",
            })
          : spawn("task", ["hive:verify"], { stdio: "inherit" });
        child.once("error", rejectRun);
        child.once("close", (code, signal) => {
          if (code === 0 && !signal) resolveRun();
          else rejectRun(new Error("Isolated validation command failed"));
        });
      });
    if (args[0] === "hive:verify" && args.length === 1) await wait(false);
    else if (
      args[0] === "docker:ecosystem:fuzz" &&
      args[1] === "FUZZ_SECONDS=20" &&
      args.length === 2
    )
      await wait(true);
    else throw new Error("Isolated validation command is not allowlisted");
  } finally {
    new AgentRuntimeRestoreHostEnvironment({
      snapshot: hostEnvironment,
      environment: process.env,
    }).execute();
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

export class CiFixProfileName {
  constructor(private readonly value: string = "") {}
  parse(): CiAgentFixProfile {
    const value = this.value;
    const profile = value.trim();
    if (!profile) return CiAgentFixProfile.Default;
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      return CiAgentFixProfile.RustDependencyUpdate;
    }
    throw new Error(`Unsupported CI_AGENT_FIX_PROFILE: ${profile}`);
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

type PublishedPullRequest = {
  base: { ref: string };
  head: { ref: string; sha: string };
  number: number;
};
