import {
  DependencyFixWithValidationEnvironment,
  RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS,
  runValidationCommand,
  type ValidationRunner,
} from "./dependency-validation.js";
export {
  DependencyFixCreateValidationEnvironment,
  DependencyFixWithValidationEnvironment,
  RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS,
  runValidationCommand,
} from "./dependency-validation.js";
import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "./github.js";
import { GithubRequestFailure } from "./github-failure.js";
import { CiWorkingDirectory } from "./process.js";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import { AgentFile } from "./agent-files.js";
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
} from "./git-configuration.js";
export { GitConfiguration } from "./git-configuration.js";
import {
  RustDependencyDocument,
  RustDependencyPath,
} from "./rust-dependency-document.js";
import { join, resolve, sep } from "node:path";

import {
  type CiAgentConfig,
  CiAgentConfigLoadKind,
  CiAgentEnvironment,
} from "./config.js";
import {
  GitHubClient,
  GitHubEnvironment,
  OpenPrLookupKind,
  GitHubRepositoryName,
} from "./github.js";
import { CiRepository } from "./git.js";
import { Logger } from "./logger.js";
import { AgentPrompt } from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
export class CiFixCommand {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  async runCiFix(): Promise<Result<CiFixOutcome, CiFailure>> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim(),
      runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId)
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_REPOSITORY and GITHUB_RUN_ID are required",
      });
    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const fixBranch = this.environment.FIX_BRANCH?.trim() || `fix/ci-${runId}`;
    const profile = new CiFixProfileName(
      this.environment.CI_AGENT_FIX_PROFILE || "",
    ).parse();
    if (profile.isErr()) return err(profile.error);
    const entered = new CiWorkingDirectory(repoRoot).enter();
    if (entered.isErr()) return err(entered.error);
    const client = new GitHubEnvironment(process.env).createOctokit();
    if (client.isErr()) return err(client.error);
    const octokit = client.value;
    const configured = await new CiRepository(repoRoot).configureGitForCi({
      octokit,
    });
    if (configured.isErr()) return err(configured.error);
    const repositoryName = new GitHubRepositoryName(repository).parse();
    if (repositoryName.isErr()) return err(repositoryName.error);
    const repoRef = repositoryName.value;
    const openPr = await new GitHubClient(octokit).findOpenPr({
      subject1: repoRef,
      headBranch: fixBranch,
    });
    if (openPr.isErr()) return err(openPr.error);
    let prNumber: number;
    if (openPr.value.kind === OpenPrLookupKind.Found) {
      prNumber = openPr.value.number;
      if (profile.value === CiAgentFixProfile.RustDependencyUpdate) {
        const audited = await this.auditExistingDependencyBranch(
          repoRoot,
          fixBranch,
        );
        if (audited.isErr()) return err(audited.error);
      }
    } else {
      const loaded = new CiAgentEnvironment(process.env).loadConfig();
      if (loaded.kind === CiAgentConfigLoadKind.MissingApiKey) {
        console.log(
          "::warning::CURSOR_API_KEY is not set — skipping AI CI fix job.",
        );
        return ok(CI_FIX_SKIPPED);
      }
      const edited = await this.edit(repoRoot, profile.value, loaded.config);
      if (edited.isErr()) return err(edited.error);
      if (edited.value === CiFixEdit.Unchanged) return ok(CI_FIX_SKIPPED);
      const pushed = await new CiRepository(repoRoot).pushFixBranch({
        fixBranch,
        runId,
      });
      if (pushed.isErr()) return err(pushed.error);
      const published = await new GitHubClient(octokit).findOpenPr({
        subject1: repoRef,
        headBranch: fixBranch,
      });
      if (published.isErr()) return err(published.error);
      if (published.value.kind === OpenPrLookupKind.Found)
        prNumber = published.value.number;
      else {
        const created = await new GitHubClient(octokit).createFixPr({
          repoRef,
          headBranch: fixBranch,
          runId,
          fixLabel: loaded.config.fixLabel,
          baseBranch: "main",
        });
        if (created.isErr()) return err(created.error);
        prNumber = created.value;
      }
    }
    const head = await new CiRepository(repoRoot).revParse({ ref: "HEAD" });
    if (head.isErr()) return err(head.error);
    const published = await new DependencyFixVerifyLiveFixPublication({
      expectedHeadSha: head.value,
      fixBranch,
      octokit,
      prNumber,
      repoRef,
    }).execute();
    if (published.isErr()) return err(published.error);
    const fixLabel = this.environment.CI_FIX_LABEL?.trim() || "main CI";
    log.info(
      `PR #${prNumber} exact head ${published.value.headSha} verified and handed to the continuing Gizmo owner`,
    );
    log.info(
      `PR #${prNumber} is open without automatic merge; ${fixLabel} run ${runId} requires explicit merge authorization`,
    );
    return published;
  }
  private async auditExistingDependencyBranch(
    repoRoot: string,
    fixBranch: string,
  ): Promise<Result<void, CiFailure>> {
    const token = this.environment.NOOK_GITHUB_PAT?.trim();
    const prior = Object.fromEntries(
      ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]
        .filter((name) => Object.hasOwn(this.environment, name))
        .map((name) => [name, this.environment[name]]),
    );
    if (token) {
      this.environment.GIT_CONFIG_COUNT = "1";
      this.environment.GIT_CONFIG_KEY_0 =
        "http.https://github.com/.extraheader";
      this.environment.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    }
    const repository = new DependencyFixRepository(repoRoot);
    const fetched = await repository.gitOutput({
      args: ["fetch", "--depth=1", "origin", "main", fixBranch],
    });
    for (const name of [
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
    ]) {
      if (Object.hasOwn(prior, name)) this.environment[name] = prior[name];
      else delete this.environment[name];
    }
    if (fetched.isErr()) return err(fetched.error);
    const checkout = await repository.gitOutput({
      args: ["checkout", "--force", `origin/${fixBranch}`],
    });
    if (checkout.isErr()) return err(checkout.error);
    const base = await repository.gitOutput({
      args: ["merge-base", "origin/main", "HEAD"],
    });
    if (base.isErr()) return err(base.error);
    const auditedBase = base.value.trim();
    const changes = await repository.collectCommittedChangeSet({
      base: auditedBase,
    });
    if (changes.isErr()) return err(changes.error);
    const admitted = await repository.assertTrustedChangeSet({
      baseline: auditedBase,
      changes: changes.value,
    });
    if (admitted.isErr()) return err(admitted.error);
    return repository.runValidationWithoutPublicationCredentials();
  }
  private async edit(
    repoRoot: string,
    profile: CiAgentFixProfile,
    config: CiAgentConfig,
  ): Promise<Result<CiFixEdit, CiFailure>> {
    const repository = new DependencyFixRepository(repoRoot);
    let baselineState: RepositoryBaselineState = {
      kind: RepositoryBaselineKind.NotRequired,
    };
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      const credentials =
        await repository.assertCheckoutHasNoPersistedCredentials();
      if (credentials.isErr()) return err(credentials.error);
      const baseline = await repository.captureRepositoryBaseline();
      if (baseline.isErr()) return err(baseline.error);
      baselineState = {
        kind: RepositoryBaselineKind.Captured,
        baseline: baseline.value,
      };
    }
    const prompt = await new AgentPrompt(config).load();
    if (prompt.isErr()) return err(prompt.error);
    const run = await new ConfiguredAgentRuntime(config).runFixAgent({
      prompt: prompt.value,
      isolation: new DependencyFixIsolationForFixProfile(profile).execute(),
    });
    if (run.isErr()) return err(run.error);
    if (baselineState.kind === RepositoryBaselineKind.Captured) {
      const unchanged = await repository.assertBaselineUnchanged({
        baseline: baselineState.baseline,
      });
      if (unchanged.isErr()) return err(unchanged.error);
    }
    const changed = await new CiRepository(repoRoot).hasWorkingTreeChanges();
    if (changed.isErr()) return err(changed.error);
    if (!changed.value) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return ok(CiFixEdit.Unchanged);
    }
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      if (baselineState.kind !== RepositoryBaselineKind.Captured)
        return err({
          kind: CiFailureKind.Baseline,
          message: "Rust dependency update baseline was not captured",
        });
      const { baseline } = baselineState;
      const before = await this.admitEdit(repository, baseline);
      if (before.isErr()) return err(before.error);
      const validated =
        await repository.runValidationWithoutPublicationCredentials();
      if (validated.isErr()) return err(validated.error);
      const after = await this.admitEdit(repository, baseline);
      if (after.isErr()) return err(after.error);
    }
    return ok(CiFixEdit.Changed);
  }
  private async admitEdit(
    repository: DependencyFixRepository,
    baseline: RepositoryBaseline,
  ): Promise<Result<void, CiFailure>> {
    const unchanged = await repository.assertBaselineUnchanged({ baseline });
    if (unchanged.isErr()) return err(unchanged.error);
    const changes = await repository.collectChangedPaths();
    if (changes.isErr()) return err(changes.error);
    return repository.assertTrustedChangeSet({
      baseline: baseline.headSha,
      changes: changes.value,
    });
  }
}
enum CiFixEdit {
  Unchanged,
  Changed,
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
  readonly baselineContentForPath?: (
    path: string,
  ) => Promise<Result<string, CiFailure>>;
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
  gitOutput({ args }: DependencyFixRepositoryGitOutputRequest) {
    return new CiRepository(this.value)
      .trustedGit({ args })
      .map(({ stdout }) => stdout);
  }
  currentIndexTree() {
    return this.gitOutput({ args: ["write-tree"] }).map((value) =>
      value.trim(),
    );
  }
  async captureGitMetadataBaseline(): Promise<
    Result<RepositoryBaseline["gitMetadata"], CiFailure>
  > {
    const records = await ResultAsync.combine([
      this.gitOutput({
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      }),
      this.gitOutput({
        args: ["config", "--null", "--show-origin", "--show-scope", "--list"],
      }),
      this.gitOutput({ args: ["rev-parse", "--absolute-git-dir"] }),
    ]);
    if (records.isErr()) return err(records.error);
    const [commonDirectory, configuration, gitDirectory] = records.value;
    const gitDir = gitDirectory.trim();
    const excluded = await new AgentFile(
      join(gitDir, "info", "exclude"),
    ).read();
    const exclude = excluded.isOk() ? excluded.value : "";
    const flags = await this.gitOutput({ args: ["ls-files", "-v"] });
    if (flags.isErr()) return err(flags.error);
    if (
      flags.value
        .split("\n")
        .some((line) => line.startsWith("S") || line.startsWith("h"))
    )
      return err({
        kind: CiFailureKind.Baseline,
        message: "Bounded editor set nondefault Git index flags",
      });
    return ok({
      commonDirectory: commonDirectory.trim(),
      configuration: `${configuration}\0${exclude}\0${flags.value}`,
      gitDirectory: gitDir,
    });
  }
  async captureRepositoryBaseline(): Promise<
    Result<RepositoryBaseline, CiFailure>
  > {
    const trees = await ResultAsync.combine([
      new CiRepository(this.value).revParse({ ref: "HEAD" }),
      new CiRepository(this.value).revParse({ ref: "HEAD^{tree}" }),
      this.currentIndexTree(),
    ]);
    if (trees.isErr()) return err(trees.error);
    const [headSha, headTreeSha, indexTreeSha] = trees.value;
    const changes = await this.collectChangedPaths();
    if (changes.isErr()) return err(changes.error);
    if (indexTreeSha !== headTreeSha || changes.value.length !== 0)
      return err({
        kind: CiFailureKind.Baseline,
        message: "Trusted dependency-update baseline checkout is not clean",
      });
    const metadata = await this.captureGitMetadataBaseline();
    return metadata.map((gitMetadata) => ({
      gitMetadata,
      headSha,
      indexTreeSha,
    }));
  }
  async assertBaselineUnchanged({
    baseline,
  }: DependencyFixRepositoryAssertBaselineUnchangedRequest): Promise<
    Result<void, CiFailure>
  > {
    const head = await new CiRepository(this.value).revParse({ ref: "HEAD" });
    if (head.isErr()) return err(head.error);
    const index = await this.currentIndexTree();
    if (index.isErr()) return err(index.error);
    const trees = new DependencyFixAssertRepositoryBaselineUnchanged({
      baseline,
      currentHeadSha: head.value,
      currentIndexTreeSha: index.value,
    }).execute();
    if (trees.isErr()) return err(trees.error);
    const metadata = await this.captureGitMetadataBaseline();
    if (metadata.isErr()) return err(metadata.error);
    return new DependencyFixAssertGitMetadataBaselineUnchanged({
      baseline: baseline.gitMetadata,
      current: metadata.value,
    }).execute();
  }
  async collectChangedPaths(): Promise<Result<ChangedPath[], CiFailure>> {
    const status = await this.gitOutput({
      args: [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ".",
      ],
    });
    return status.andThen((source) =>
      new DependencyFixParsePorcelainStatus(source).execute(),
    );
  }
  async assertRustDependencyUpdateChangeSet({
    changes,
    baselineModeForPath = async () => ok(""),
    baselineContentForPath = async () => ok(""),
  }: DependencyFixRepositoryAssertRustDependencyUpdateChangeSetRequest): Promise<
    Result<void, CiFailure>
  > {
    if (changes.length === 0)
      return err({
        kind: CiFailureKind.Dependency,
        message: "Trusted dependency-update change set is empty",
      });
    const root = resolve(this.value);
    for (const change of changes) {
      if (change.path.startsWith("/") || change.path.split("/").includes(".."))
        return err({
          kind: CiFailureKind.Dependency,
          message: "Dependency-update path escapes the repository",
        });
      const path = new RustDependencyPath(change.path);
      if (path.isOrchestrationControl())
        return err({
          kind: CiFailureKind.Dependency,
          message: `Dependency update changed trusted orchestration control: ${change.path}`,
        });
      if (!path.isAllowed())
        return err({
          kind: CiFailureKind.Dependency,
          message: `Dependency update changed forbidden path: ${change.path}`,
        });
      const absolutePath = resolve(root, change.path);
      if (!absolutePath.startsWith(`${root}${sep}`))
        return err({
          kind: CiFailureKind.Dependency,
          message: "Dependency-update path escapes the repository",
        });
      const metadata = await new AgentFile(absolutePath).metadata();
      if (metadata.isErr()) {
        if (
          metadata.error.kind === CiFailureKind.Combined ||
          metadata.error.code !== "ENOENT" ||
          !change.status.includes("D")
        )
          return err(metadata.error);
        const baselineMode = await baselineModeForPath(change.path);
        if (baselineMode.isErr()) return err(baselineMode.error);
        if (baselineMode.value !== "100644" && baselineMode.value !== "100755")
          return err({
            kind: CiFailureKind.Dependency,
            message: `Dependency update deleted a symlink or special file: ${change.path}`,
          });
        continue;
      }
      if (!metadata.value.isFile())
        return err({
          kind: CiFailureKind.Dependency,
          message: `Dependency update produced a symlink or special file: ${change.path}`,
        });
      if (
        change.path.endsWith("Cargo.toml") ||
        change.path.endsWith("Cargo.lock")
      ) {
        const content = await new AgentFile(absolutePath).read();
        if (content.isErr()) return err(content.error);
        const baseline = await baselineContentForPath(change.path);
        if (baseline.isErr()) return err(baseline.error);
        const admitted = new RustDependencyDocument({
          path: change.path,
          content: content.value,
          baseline: baseline.value,
        }).validateSources();
        if (admitted.isErr()) return err(admitted.error);
      }
    }
    return ok();
  }
  async gitShow({
    spec,
  }: DependencyFixRepositoryGitShowRequest): Promise<
    Result<string, CiFailure>
  > {
    const content = await this.gitOutput({ args: ["show", spec] });
    return content.isOk() ? content : ok("");
  }
  async collectCommittedChangeSet({
    base,
  }: DependencyFixRepositoryCollectCommittedChangeSetRequest): Promise<
    Result<ChangedPath[], CiFailure>
  > {
    const source = await this.gitOutput({
      args: ["diff", "-z", "--name-status", base],
    });
    if (source.isErr()) return err(source.error);
    const records = new NulSeparatedRecords(source.value).values();
    let changes: ChangedPath[] = [];
    for (let index = 0; index < records.length;) {
      const status = records[index];
      const path = records[index + 1];
      if (!status || !path)
        return err({
          kind: CiFailureKind.Schema,
          message: "Malformed Git committed change record",
        });
      if (status.startsWith("R") || status.startsWith("C")) {
        const destination = records[index + 2];
        if (!destination)
          return err({
            kind: CiFailureKind.Schema,
            message: "Malformed Git committed rename record",
          });
        changes = [...changes, { path: destination, status }, { path, status }];
        index += 3;
      } else {
        changes = [...changes, { path, status: status.padEnd(2, " ") }];
        index += 2;
      }
    }
    return ok(changes);
  }
  assertTrustedChangeSet({
    baseline,
    changes,
  }: DependencyFixRepositoryAssertTrustedChangeSetRequest) {
    return this.assertRustDependencyUpdateChangeSet({
      changes,
      baselineModeForPath: async (path) =>
        this.gitOutput({ args: ["ls-tree", baseline, "--", path] }).map(
          (source) => /^(\d{6})\s/u.exec(source)?.[1] || "",
        ),
      baselineContentForPath: (path) =>
        this.gitShow({ spec: `${baseline}:${path}` }),
    });
  }
  async assertCheckoutHasNoPersistedCredentials(): Promise<
    Result<void, CiFailure>
  > {
    const config = await this.gitOutput({
      args: ["config", "--null", "--list"],
    });
    return config
      .andThen((source) => new GitConfigurationText(source).decode())
      .andThen((entries) =>
        new GitConfiguration(entries).assertCredentialFree(),
      );
  }
  async runRustDependencyUpdateValidation({
    sanitizedEnvironment,
    runner = runValidationCommand,
  }: DependencyFixRepositoryRunRustDependencyUpdateValidationRequest): Promise<
    Result<void, CiFailure>
  > {
    for (const validation of RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS) {
      const outcome = await runner("task", validation.args, {
        cwd: this.value,
        env: { ...sanitizedEnvironment, ...validation.environment },
      });
      if (outcome.isErr()) return err(outcome.error);
    }
    return ok();
  }
  runValidationWithoutPublicationCredentials() {
    return new DependencyFixWithValidationEnvironment({
      environment: process.env,
      operation: (sanitizedEnvironment) =>
        this.runRustDependencyUpdateValidation({ sanitizedEnvironment }),
    }).execute();
  }
}

export class DependencyFixParsePorcelainStatus {
  constructor(private readonly request: string) {}
  execute(): Result<ChangedPath[], CiFailure> {
    const output = this.request;

    const records = new NulSeparatedRecords(output).values();
    let changes: ChangedPath[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records.at(index);
      if (!record)
        return err({
          kind: CiFailureKind.Dependency,
          message: "Malformed Git status record",
        });
      if (record.length < 4 || record[2] !== " ") {
        return err({
          kind: CiFailureKind.Dependency,
          message: "Malformed Git status record",
        });
      }
      const status = record.slice(0, 2);
      changes = [...changes, { path: record.slice(3), status }];
      if (status.includes("R") || status.includes("C")) {
        const source = records[index + 1];
        if (!source)
          return err({
            kind: CiFailureKind.Dependency,
            message: "Malformed Git rename status record",
          });
        changes = [...changes, { path: source, status }];
        index += 1;
      }
    }
    return ok(changes);
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

export class DependencyFixAssertPublishedFixIdentity {
  constructor(private readonly request: PublishedFixIdentity) {}
  execute(): Result<string, CiFailure> {
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
      return err({
        kind: CiFailureKind.Dependency,
        message: `Published ${mismatch[0]} changed: expected ${mismatch[2]}, got ${mismatch[1]}`,
      });
    return ok(identity.expectedHeadSha);
  }
}

export class DependencyFixVerifyPublishedFix {
  constructor(
    private readonly request: {
      expectedBaseRef: string;
      expectedHeadRef: string;
      expectedHeadSha: string;
      expectedPrNumber: number;
      fetchPullRequest: () => Promise<Result<PublishedPullRequest, CiFailure>>;
      fetchRemoteHeadSha: () => Promise<Result<string, CiFailure>>;
    },
  ) {}
  async execute(): Promise<Result<string, CiFailure>> {
    const args = this.request;

    const [pullRequest, remoteHeadSha] = await Promise.all([
      args.fetchPullRequest(),
      args.fetchRemoteHeadSha(),
    ]);
    if (pullRequest.isErr()) return err(pullRequest.error);
    if (remoteHeadSha.isErr()) return err(remoteHeadSha.error);
    return new DependencyFixAssertPublishedFixIdentity({
      actualBaseRef: pullRequest.value.base.ref,
      actualHeadRef: pullRequest.value.head.ref,
      actualHeadSha: pullRequest.value.head.sha,
      actualPrNumber: pullRequest.value.number,
      actualRemoteHeadSha: remoteHeadSha.value,
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
      octokit: Octokit;
      prNumber: number;
      repoRef: RepoRef;
    },
  ) {}
  async execute(): Promise<Result<PublishedCiFixOutcome, CiFailure>> {
    const args = this.request;

    const verified = await new DependencyFixVerifyPublishedFix({
      expectedBaseRef: "main",
      expectedHeadRef: args.fixBranch,
      expectedHeadSha: args.expectedHeadSha,
      expectedPrNumber: args.prNumber,
      fetchPullRequest: async () => {
        const response = await ResultAsync.fromPromise(
          args.octokit.rest.pulls.get({
            ...args.repoRef,
            pull_number: args.prNumber,
          }),
          (cause) => new GithubRequestFailure(cause).outcome(),
        );
        return response.map(({ data }) => data);
      },
      fetchRemoteHeadSha: async () => {
        const response = await ResultAsync.fromPromise(
          args.octokit.rest.repos.getBranch({
            ...args.repoRef,
            branch: args.fixBranch,
          }),
          (cause) => new GithubRequestFailure(cause).outcome(),
        );
        return response.map(({ data }) => data.commit.sha);
      },
    }).execute();
    return verified.map((headSha) => ({
      headSha,
      kind: CiFixOutcomeKind.Published as const,
    }));
  }
}

const log = new Logger("fix");

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

type BaselineModeLookup = (path: string) => Promise<Result<string, CiFailure>>;

export class CiFixProfileName {
  constructor(private readonly value: string = "") {}
  parse(): Result<CiAgentFixProfile, CiFailure> {
    const value = this.value;
    const profile = value.trim();
    if (!profile) return ok(CiAgentFixProfile.Default);
    if (profile === CiAgentFixProfile.RustDependencyUpdate) {
      return ok(CiAgentFixProfile.RustDependencyUpdate);
    }
    return err({
      kind: CiFailureKind.Dependency,
      message: `Unsupported CI_AGENT_FIX_PROFILE: ${profile}`,
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

type PublishedPullRequest = {
  base: { ref: string };
  head: { ref: string; sha: string };
  number: number;
};
