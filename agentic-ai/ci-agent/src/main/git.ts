import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import {
  CiProcess,
  CiProcessGitSecurityPolicy,
} from "./process.js";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Octokit } from "@octokit/rest";

import { Logger } from "./logger.js";
const execFileAsync = promisify(execFile);
export interface AuthoredNumstatSummarizeAuthoredNumstatRequest {
  readonly deletedPaths?: ReadonlySet<string>;
}

export class AuthoredNumstat {
  constructor(private readonly value: string) {}
  summarizeAuthoredNumstat(
    request: AuthoredNumstatSummarizeAuthoredNumstatRequest = {},
  ): AuthoredNumstatSummary {
    const numstat = this.value;
    const { deletedPaths = new Set() } = request;

    let authoredLines = 0;
    let reportedOnly = this.emptyReportedOnlyNumstat();
    const records = numstat.split("\0");
    let index = 0;
    while (index < records.length) {
      const parseArgs: ParseNumstatRecordArgs = { records, index };
      const parsed = new NumstatCursor(parseArgs).read();
      if (parsed.kind === NumstatRecordParseKind.End) break;
      index = parsed.nextIndex;
      if (parsed.kind === NumstatRecordParseKind.Malformed) {
        reportedOnly = {
          ...reportedOnly,
          malformedRecords: reportedOnly.malformedRecords + 1,
        };
        continue;
      }
      const normalizedPath = `/${parsed.destinationPath.replaceAll("\\", "/")}`;
      const filename = normalizedPath.slice(
        normalizedPath.lastIndexOf("/") + 1,
      );
      if (!/^\d+$/.test(parsed.added) || !/^\d+$/.test(parsed.deleted)) {
        if (deletedPaths.has(parsed.destinationPath)) {
          reportedOnly = {
            ...reportedOnly,
            binaryFiles: reportedOnly.binaryFiles + 1,
          };
          continue;
        }
        const extensionStart = filename.lastIndexOf(".");
        const extension =
          extensionStart >= 0 ? filename.slice(extensionStart) : "";
        if (AUTHORED_TEXT_EXTENSIONS.has(extension)) {
          reportedOnly = {
            ...reportedOnly,
            unmeasurableAuthoredFiles:
              reportedOnly.unmeasurableAuthoredFiles + 1,
          };
        } else {
          reportedOnly = {
            ...reportedOnly,
            binaryFiles: reportedOnly.binaryFiles + 1,
          };
        }
        continue;
      }
      const addedLines = Number(parsed.added);
      const changedLines = addedLines + Number(parsed.deleted);
      if (REPORTED_ONLY_FILENAMES.has(filename)) {
        reportedOnly = {
          ...reportedOnly,
          lockfileLines: reportedOnly.lockfileLines + changedLines,
        };
      } else if (normalizedPath.endsWith(".snap")) {
        reportedOnly = {
          ...reportedOnly,
          snapshotLines: reportedOnly.snapshotLines + changedLines,
        };
      } else if (
        normalizedPath.includes("/generated/") ||
        REPOSITORY_GENERATED_PATHS.has(normalizedPath)
      ) {
        reportedOnly = {
          ...reportedOnly,
          generatedLines: reportedOnly.generatedLines + changedLines,
        };
      } else if (normalizedPath.includes("/vendor/")) {
        reportedOnly = {
          ...reportedOnly,
          vendoredLines: reportedOnly.vendoredLines + changedLines,
        };
      } else if (normalizedPath.includes("/dist/")) {
        reportedOnly = {
          ...reportedOnly,
          generatedLines: reportedOnly.generatedLines + changedLines,
        };
      } else if (parsed.renamed && changedLines === 0) {
        reportedOnly = {
          ...reportedOnly,
          pureRenameFiles: reportedOnly.pureRenameFiles + 1,
        };
      } else {
        authoredLines += addedLines;
      }
    }
    return { authoredLines, reportedOnly };
  }

  countAuthoredNumstat(): number {
    const numstat = this.value;

    return new AuthoredNumstat(numstat).summarizeAuthoredNumstat()
      .authoredLines;
  }

  private emptyReportedOnlyNumstat(): ReportedOnlyNumstat {
    return {
      binaryFiles: 0,
      generatedLines: 0,
      lockfileLines: 0,
      malformedRecords: 0,
      pureRenameFiles: 0,
      snapshotLines: 0,
      unmeasurableAuthoredFiles: 0,
      vendoredLines: 0,
    };
  }
}

export interface CiRepositoryTrustedGitArgsRequest {
  readonly args: readonly string[];
}

export interface CiRepositoryTrustedGitRequest {
  readonly args: readonly string[];
}

export interface CiRepositoryImmutableGitRequest {
  readonly args: readonly string[];
}

export interface CiRepositoryConfigureGitForCiRequest {
  readonly octokit?: Octokit;
}

export interface CiRepositoryPushFixBranchRequest {
  readonly fixBranch: string;
  readonly runId: string;
  /**
   * When present, the remote branch must still point at this commit. The
   * publication path uses this as its expected remote lease so an unrelated
   * update cannot be overwritten.
   */
  readonly expectedRemoteHeadSha?: string;
  /**
   * Optional caller-supplied values are checked against the canonical
   * workflow target before they can reach Git. They are not remote aliases.
   */
  readonly remoteRef?: string;
  readonly remoteUrl?: string;
}

export interface CiRepositoryRevParseRequest {
  readonly ref: string;
}

export class CiRepository {
  constructor(private readonly value: string) {}
  trustedGitArgs({ args }: CiRepositoryTrustedGitArgsRequest): string[] {
    return ["-C", this.value, ...TRUSTED_GIT_OPTIONS, ...args];
  }
  trustedGit({ args }: CiRepositoryTrustedGitRequest) {
    return new CiProcess(this.trustedGitArgs({ args })).execute();
  }
  immutableGit({ args }: CiRepositoryImmutableGitRequest) {
    return new CiProcess(this.trustedGitArgs({ args }), {
      gitSecurity: CiProcessGitSecurityPolicy.ImmutableObjects,
    }).execute();
  }
  excludeAgentRuntimeArtifacts() {
    return this.trustedGit({
      args: ["reset", "--quiet", "HEAD", "--", ...AGENT_RUNTIME_ARTIFACTS],
    }).map(() => {});
  }
  async markSafeDirectory(): Promise<Result<void, CiFailure>> {
    const explicit = await new CiProcess([
      "config",
      "--global",
      "--add",
      "safe.directory",
      this.value,
    ]).execute();
    const wildcard = await new CiProcess([
      "config",
      "--global",
      "--add",
      "safe.directory",
      "*",
    ]).execute();
    if (explicit.isErr() && wildcard.isErr()) return err(explicit.error);
    return ok();
  }
  async assertGitRepo(): Promise<Result<void, CiFailure>> {
    const present = await ResultAsync.fromPromise(
      access(join(this.value, ".git")),
      (): CiFailure => ({
        kind: CiFailureKind.Git,
        message: `REPO_ROOT is not a git working tree (missing .git): ${this.value}. If running in Docker, bind-mount the Actions checkout (and RUNNER_TEMP if .git is a gitfile).`,
      }),
    );
    if (present.isErr()) return err(present.error);
    return this.immutableGit({ args: ["rev-parse", "--git-dir"] }).map(
      () => {},
    );
  }
  async configureGitForCi({
    octokit,
  }: CiRepositoryConfigureGitForCiRequest = {}): Promise<
    Result<void, CiFailure>
  > {
    const safe = await this.markSafeDirectory();
    if (safe.isErr()) return err(safe.error);
    const repository = await this.assertGitRepo();
    if (repository.isErr()) return err(repository.error);
    let userEmail: string = ACTIONS_BOT.email;
    let userName: string = ACTIONS_BOT.name;
    if (octokit) {
      const identity = await ResultAsync.fromPromise(
        octokit.rest.users.getAuthenticated(),
        (): CiFailure => ({
          kind: CiFailureKind.Github,
          message: "Unable to resolve authenticated Git identity",
        }),
      );
      if (identity.isOk()) {
        const { data } = identity.value;
        userName = data.name?.trim() || data.login;
        userEmail =
          data.email?.trim() ||
          `${data.id}+${data.login}@users.noreply.github.com`;
      }
    }
    for (const [key, value] of [
      ["user.email", userEmail],
      ["user.name", userName],
      ["core.untrackedCache", "true"],
    ] as const) {
      const configured = await new CiProcess([
        "config",
        "--global",
        key,
        value,
      ]).execute();
      if (configured.isErr()) return err(configured.error);
    }
    log.info(
      `Configured git identity as ${userName} <${userEmail}> in ${this.value}`,
    );
    return ok();
  }
  async hasWorkingTreeChanges(): Promise<Result<boolean, CiFailure>> {
    const excluded = await this.excludeAgentRuntimeArtifacts();
    if (excluded.isErr()) return err(excluded.error);
    return this.trustedGit({
      args: ["status", "--porcelain", "--", ".", ...AGENT_RUNTIME_EXCLUSIONS],
    }).map(({ stdout }) => stdout.trim().length > 0);
  }
  private async pushAuthenticatedBranch(
    target: CiRepositoryPushTarget,
    expectedRemoteHeadSha?: string,
  ): Promise<void> {
    const repoRoot = this.value;

    const token = process.env.NOOK_GITHUB_PAT?.trim();
    const authEnv = { ...process.env };
    for (const name of Object.keys(authEnv)) {
      if (
        name === "GIT_CONFIG" ||
        name === "GIT_CONFIG_COUNT" ||
        name === "GIT_CONFIG_PARAMETERS" ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name) ||
        name === "GIT_DIR" ||
        name === "GIT_WORK_TREE" ||
        name === "GIT_COMMON_DIR" ||
        name === "GIT_INDEX_FILE" ||
        name === "GIT_OBJECT_DIRECTORY" ||
        name === "GIT_ALTERNATE_OBJECT_DIRECTORIES" ||
        name === "GIT_NAMESPACE" ||
        name === "GIT_REPLACE_REF_BASE" ||
        name === "GIT_SSH" ||
        name === "GIT_SSH_COMMAND" ||
        name === "GIT_PROXY_COMMAND" ||
        name === "GIT_ASKPASS" ||
        name === "SSH_ASKPASS" ||
        /^(?:ALL|HTTP|HTTPS|NO)_PROXY$/u.test(name) ||
        /^(?:all|http|https|no)_proxy$/u.test(name) ||
        /^GIT_TRACE(?:2(?:_|$)|_|$)/u.test(name)
      ) {
        delete authEnv[name];
      }
    }
    delete authEnv.NOOK_GITHUB_PAT;
    delete authEnv.NOOK_GIT_EXTRAHEADER;
    authEnv.GIT_CONFIG_GLOBAL = "/dev/null";
    authEnv.GIT_CONFIG_SYSTEM = "/dev/null";
    authEnv.GIT_CONFIG_NOSYSTEM = "1";
    authEnv.GIT_NO_REPLACE_OBJECTS = "1";
    authEnv.GIT_TERMINAL_PROMPT = "0";
    authEnv.GIT_ALLOW_PROTOCOL = "https";

    let localConfig: { stdout: string };
    try {
      localConfig = await execFileAsync(
        "git",
        [
          "-C",
          repoRoot,
          ...TRUSTED_PUBLICATION_GIT_OPTIONS,
          "config",
          "--local",
          "--no-includes",
          "--name-only",
          "--get-regexp",
          ".*",
        ],
        { env: authEnv },
      );
    } catch (cause) {
      const code =
        cause instanceof Error &&
        "code" in cause &&
        (typeof cause.code === "number" || typeof cause.code === "string")
          ? cause.code
          : false;
      if (code !== 1) throw cause;
      localConfig = { stdout: "" };
    }
    const unsafeKeys = localConfig.stdout
      .split("\n")
      .map((key) => key.trim().toLowerCase())
      .filter(
        (key) =>
          /^include(?:if\..+)?\.path$/u.test(key) ||
          /^url\..+\.(?:insteadof|pushinsteadof)$/u.test(key) ||
          /^url\..+\.instead-of$/u.test(key) ||
          /^http\..*(?:proxy|extraheader)$/u.test(key) ||
          /^credential\..*helper$/u.test(key) ||
          /^core\.(?:gitproxy|sshcommand)$/u.test(key) ||
          /^protocol\..+$/u.test(key) ||
          /^remote\..+\.pushurl$/u.test(key),
      );
    if (unsafeKeys.length > 0) {
      throw new Error(
        "Refusing Git publication because local includes or unsafe publication configuration is present",
      );
    }
    authEnv.GIT_CONFIG = "/dev/null";
    const publicationGitOptions = token
      ? [
          ...TRUSTED_PUBLICATION_GIT_OPTIONS,
          "--config-env=http.https://github.com/.extraheader=NOOK_GIT_EXTRAHEADER",
        ]
      : TRUSTED_PUBLICATION_GIT_OPTIONS;
    if (token) {
      authEnv.NOOK_GIT_EXTRAHEADER = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    }
    await execFileAsync(
      "git",
      [
        "-C",
        repoRoot,
        ...publicationGitOptions,
        "push",
        "--no-verify",
        "-u",
        ...(expectedRemoteHeadSha === undefined
          ? []
          : [`--force-with-lease=${target.remoteRef}:${expectedRemoteHeadSha}`]),
        target.remoteUrl,
        `HEAD:${target.remoteRef}`,
      ],
      {
        env: authEnv,
      },
    );
  }
  async pushFixBranch({
    fixBranch,
    runId,
    expectedRemoteHeadSha,
    remoteRef,
    remoteUrl,
  }: CiRepositoryPushFixBranchRequest): Promise<Result<string, CiFailure>> {
    log.info(`Pushing fix branch ${fixBranch}`);
    const target = this.resolvePushTarget({ fixBranch, remoteRef, remoteUrl });
    if (target.isErr()) return err(target.error);
    if (
      expectedRemoteHeadSha !== undefined &&
      !FULL_COMMIT_SHA.test(expectedRemoteHeadSha)
    ) {
      return err({
        kind: CiFailureKind.Configuration,
        message:
          "expectedRemoteHeadSha must be an exact lowercase 40-hex commit SHA",
      });
    }
    const checkout = await this.trustedGit({
      args: ["checkout", "-B", fixBranch],
    });
    if (checkout.isErr()) return err(checkout.error);
    const excluded = await this.excludeAgentRuntimeArtifacts();
    if (excluded.isErr()) return err(excluded.error);
    const added = await this.trustedGit({
      args: ["add", "-A", "--", ".", ...AGENT_RUNTIME_EXCLUSIONS],
    });
    if (added.isErr()) return err(added.error);
    const staged = await this.hasStagedChanges();
    if (staged.isErr()) return err(staged.error);
    if (!staged.value)
      return err({
        kind: CiFailureKind.Git,
        message: "No staged changes to commit after git add -A",
      });
    const commitMessage =
      process.env.AGENT_COMMIT_MESSAGE?.trim() ||
      `Fix main CI failure (run ${runId}).`;
    const committed = await this.trustedGit({
      args: ["commit", "-m", commitMessage],
    });
    if (committed.isErr()) return err(committed.error);
    const hooks = await this.trustedGit({
      args: ["config", "core.hooksPath", "/dev/null"],
    });
    if (hooks.isErr()) return err(hooks.error);
    const committedHead = await this.revParseImmutable({ ref: "HEAD" });
    if (committedHead.isErr()) return err(committedHead.error);
    const pushed = await ResultAsync.fromPromise(
      this.pushAuthenticatedBranch(target.value, expectedRemoteHeadSha),
      (cause): CiFailure => {
        const code =
          cause instanceof Error &&
          "code" in cause &&
          (typeof cause.code === "number" || typeof cause.code === "string")
            ? cause.code
            : false;
        return {
          kind: CiFailureKind.Git,
          message: "git command failed",
          ...(code === false ? {} : { code }),
        };
      },
    );
    if (pushed.isErr()) return err(pushed.error);
    log.info(`Pushed ${fixBranch}`);
    return ok(committedHead.value);
  }
  private resolvePushTarget({
    fixBranch,
    remoteRef,
    remoteUrl,
  }: Pick<
    CiRepositoryPushFixBranchRequest,
    "fixBranch" | "remoteRef" | "remoteUrl"
  >): Result<CiRepositoryPushTarget, CiFailure> {
    if (!CANONICAL_PUSH_BRANCH.test(fixBranch))
      return err({
        kind: CiFailureKind.Configuration,
        message: "Fix branch is not a canonical publication branch",
      });
    const serverUrl = process.env.GITHUB_SERVER_URL?.trim();
    if (serverUrl !== "https://github.com")
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_SERVER_URL must be the canonical GitHub HTTPS origin",
      });
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    if (!repository || !CANONICAL_GITHUB_REPOSITORY.test(repository))
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_REPOSITORY must be an owner/repository pair",
      });
    const expectedRemoteUrl = `https://github.com/${repository}.git`;
    const expectedRemoteRef = `refs/heads/${fixBranch}`;
    if (
      (remoteUrl !== undefined && remoteUrl.trim() !== expectedRemoteUrl) ||
      (remoteRef !== undefined && remoteRef.trim() !== expectedRemoteRef)
    )
      return err({
        kind: CiFailureKind.Configuration,
        message:
          "Git publication target does not match the canonical workflow target",
      });
    return ok({
      remoteUrl: expectedRemoteUrl,
      remoteRef: expectedRemoteRef,
    });
  }
  revParse({ ref }: CiRepositoryRevParseRequest) {
    return this.trustedGit({ args: ["rev-parse", ref] }).map(({ stdout }) =>
      stdout.trim(),
    );
  }
  revParseImmutable({ ref }: CiRepositoryRevParseRequest) {
    return this.immutableGit({
      args: ["rev-parse", "--verify", `${ref}^{commit}`],
    }).andThen(
      ({ stdout }) => {
        const commit = stdout.trim();
        return FULL_COMMIT_SHA.test(commit)
          ? ok(commit)
          : err({
              kind: CiFailureKind.Git,
              message: "git returned a non-canonical commit identity",
            });
      },
    );
  }
  async hasStagedChanges(): Promise<Result<boolean, CiFailure>> {
    const compared = await this.trustedGit({
      args: ["diff", "--cached", "--quiet", "--no-ext-diff"],
    });
    if (compared.isOk()) return ok(false);
    return compared.error.kind === CiFailureKind.Git &&
      compared.error.code === 1
      ? ok(true)
      : err(compared.error);
  }
}

class NumstatCursor {
  constructor(private readonly request: ParseNumstatRecordArgs) {}
  read(): NumstatRecordParseResult {
    const args = this.request;

    const record = args.records.at(args.index);
    if (typeof record !== "string" || record.length === 0) {
      return { kind: NumstatRecordParseKind.End };
    }
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      return {
        kind: NumstatRecordParseKind.Malformed,
        nextIndex: args.index + 1,
      };
    }
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    const inlinePath = record.slice(secondTab + 1);
    if (inlinePath.length > 0) {
      return {
        kind: NumstatRecordParseKind.Valid,
        nextIndex: args.index + 1,
        added,
        deleted,
        destinationPath: inlinePath,
        renamed: false,
      };
    }
    const sourcePath = args.records.at(args.index + 1);
    const destinationPath = args.records.at(args.index + 2);
    if (
      typeof sourcePath !== "string" ||
      sourcePath.length === 0 ||
      typeof destinationPath !== "string" ||
      destinationPath.length === 0
    ) {
      return {
        kind: NumstatRecordParseKind.Malformed,
        nextIndex: args.records.length,
      };
    }
    return {
      kind: NumstatRecordParseKind.Valid,
      nextIndex: args.index + 3,
      added,
      deleted,
      destinationPath,
      renamed: true,
    };
  }
}

export class AuthoredChangeBudget {
  constructor(private readonly request: AuthoredBudgetArgs) {}
  async enforce(): Promise<Result<void, CiFailure>> {
    const args = this.request;

    const excluded = await new CiRepository(
      args.repoRoot,
    ).excludeAgentRuntimeArtifacts();
    if (excluded.isErr()) return err(excluded.error);
    const staged = await new CiRepository(args.repoRoot).trustedGit({
      args: ["add", "-A", "--", ".", ...AGENT_RUNTIME_EXCLUSIONS],
    });
    if (staged.isErr()) return err(staged.error);
    const numstat = await new CiRepository(args.repoRoot).trustedGit({
      args: [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--numstat",
        "-z",
        "--find-renames",
        "-l0",
        args.baseRef,
      ],
    });
    if (numstat.isErr()) return err(numstat.error);
    const { stdout } = numstat.value;
    const deletedDiff = await new CiRepository(args.repoRoot).trustedGit({
      args: [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--diff-filter=D",
        "--name-only",
        "-z",
        args.baseRef,
      ],
    });
    if (deletedDiff.isErr()) return err(deletedDiff.error);
    const deletedPaths = new Set(
      deletedDiff.value.stdout.split("\0").filter(Boolean),
    );
    const summary = new AuthoredNumstat(stdout).summarizeAuthoredNumstat({
      deletedPaths: deletedPaths,
    });
    log.info(
      `Implemented diff contains ${summary.authoredLines} authored additions against ${args.baseRef}`,
    );
    log.info(
      `Reported-only diff rows: ${JSON.stringify(summary.reportedOnly)}`,
    );
    if (summary.authoredLines >= PR_ADDITION_WARNING) {
      log.warn(
        `Implemented diff is near the ${args.maximumLines} authored-addition budget: ${summary.authoredLines}`,
      );
    }
    if (summary.reportedOnly.unmeasurableAuthoredFiles > 0) {
      return err({
        kind: CiFailureKind.Git,
        message: `Implemented diff contains ${summary.reportedOnly.unmeasurableAuthoredFiles} authored source file(s) whose line counts are hidden by binary attributes`,
      });
    }
    if (summary.authoredLines > args.maximumLines) {
      return err({
        kind: CiFailureKind.Budget,
        message: `Implemented diff exceeds the ${args.maximumLines} authored-addition budget: ${summary.authoredLines}`,
      });
    }
    return ok();
  }
}

const log = new Logger("git");
const PR_ADDITION_WARNING = 1_500;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;

const ACTIONS_BOT = {
  email: "41898282+github-actions[bot]@users.noreply.github.com",
  name: "github-actions[bot]",
} as const;

const REPORTED_ONLY_FILENAMES = new Set([
  "Cargo.lock",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const REPOSITORY_GENERATED_PATHS = new Set([
  "/nook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts",
]);

const AGENT_RUNTIME_ARTIFACTS = [
  ".nook-workbench-plan.md",
  ".nook-workbench-worklog.md",
];
const AGENT_RUNTIME_EXCLUSIONS = AGENT_RUNTIME_ARTIFACTS.map(
  (path) => `:(exclude)${path}`,
);

const TRUSTED_GIT_OPTIONS = [
  "-c",
  "commit.gpgSign=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
] as const;

const TRUSTED_PUBLICATION_GIT_OPTIONS = [
  ...TRUSTED_GIT_OPTIONS,
  "-c",
  "credential.helper=",
  "-c",
  "core.gitProxy=none",
  "-c",
  "http.proxy=",
  "-c",
  "https.proxy=",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "protocol.http.allow=never",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "protocol.ext.allow=never",
  "-c",
  "protocol.ssh.allow=never",
  "-c",
  "protocol.git.allow=never",
  "-c",
  "protocol.ftp.allow=never",
  "-c",
  "protocol.ftps.allow=never",
] as const;

const CANONICAL_GITHUB_REPOSITORY =
  /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const CANONICAL_PUSH_BRANCH =
  /^(?:codex|fix)\/[a-z0-9]+(?:[-/.][a-z0-9]+)*$/u;

type CiRepositoryPushTarget = {
  readonly remoteRef: string;
  readonly remoteUrl: string;
};

const AUTHORED_TEXT_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".proto",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
  ".zsh",
]);

export type AuthoredBudgetArgs = {
  repoRoot: string;
  baseRef: string;
  maximumLines: number;
};

enum NumstatRecordParseKind {
  End = "end",
  Malformed = "malformed",
  Valid = "valid",
}

type NumstatRecordParseResult =
  | { kind: NumstatRecordParseKind.End }
  | { kind: NumstatRecordParseKind.Malformed; nextIndex: number }
  | {
      kind: NumstatRecordParseKind.Valid;
      nextIndex: number;
      added: string;
      deleted: string;
      destinationPath: string;
      renamed: boolean;
    };

type ParseNumstatRecordArgs = {
  records: string[];
  index: number;
};

export type ReportedOnlyNumstat = {
  binaryFiles: number;
  generatedLines: number;
  lockfileLines: number;
  malformedRecords: number;
  pureRenameFiles: number;
  snapshotLines: number;
  unmeasurableAuthoredFiles: number;
  vendoredLines: number;
};

export type AuthoredNumstatSummary = {
  authoredLines: number;
  reportedOnly: ReportedOnlyNumstat;
};
