import { err, ok, type Result } from 'neverthrow';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RepositoryCommand, RepositoryCommandExecutable } from './run.ts';
import { LoomFailureCode } from '../loom-failure.ts';

import type { RepositoryCommandRequest } from './run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export const AGENT_TEMP_DIR_TOKEN = '{agentTempDir}';
const WORKTREE_ID_LENGTH = 16;
const AGENT_TEMP_DIRECTORY_NAME = 'nook-agent-stats';

/** Owns the agent temporary directory registry and its capability transitions. */
export class AgentTemporaryDirectory {
  constructor(private readonly request: AgentTempDirectoryParts) {}
  path(): string {
    const parts = this.request;
    const canonicalWorktree = path.resolve(parts.repoRoot);
    const worktreeId = createHash('sha256')
      .update(canonicalWorktree)
      .digest('hex')
      .slice(0, WORKTREE_ID_LENGTH);

    return path.join(
      parts.osTempDirectory,
      AGENT_TEMP_DIRECTORY_NAME,
      parts.taskAnchorCommit,
      worktreeId,
    );
  }
}
export class TaskAnchorHistory {
  constructor(private readonly request: TaskAnchorSelection) {}
  commit(): string {
    const selection = this.request;
    const checkoutSuffix = ` to ${selection.branchName}`;
    const lines = selection.reflog.split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const [line = ''] = [lines[index]];
      const [commit = '', subject = ''] = line.split('\t', 2);
      if (
        selection.branchName.length > 0 &&
        /^[0-9a-f]{40}$/.test(commit) &&
        subject.startsWith('checkout: moving from ') &&
        subject.endsWith(checkoutSuffix)
      ) {
        return commit;
      }
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const [line = ''] = [lines[index]];
      const [commit = ''] = line.split('\t', 1);
      if (/^[0-9a-f]{40}$/.test(commit)) {
        return commit;
      }
    }
    return selection.currentCommit;
  }
}
export class AgentTemporaryPath {
  constructor(private readonly request: ResolveAgentTempPathRequest) {}
  resolve(): Result<string, AgentTemporaryPathFailure> {
    const request = this.request;
    if (!request.authoredPath.includes(AGENT_TEMP_DIR_TOKEN)) {
      return ok(path.resolve(request.authoredPath));
    }

    const gitHeadRequest: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Git,
      args: ['rev-parse', 'HEAD'],
      rootDirectory: request.repoRoot,
      workingDirectory: request.repoRoot,
    };
    const gitHeadLaunch = new RepositoryCommand(gitHeadRequest).execute();
    if (gitHeadLaunch.isErr()) return err(gitHeadLaunch.error);
    const gitHead = gitHeadLaunch.value;
    const gitCommit = gitHead.stdout.trim();
    if (gitHead.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(gitCommit)) {
      const failure: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: 'Could not resolve the exact Git commit for {agentTempDir}',
      };
      return err({ code: failure.code, message: failure.text });
    }

    const branchRequest: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Git,
      args: ['branch', '--show-current'],
      rootDirectory: request.repoRoot,
      workingDirectory: request.repoRoot,
    };
    const reflogRequest: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Git,
      args: ['reflog', '--format=%H%x09%gs', 'HEAD'],
      rootDirectory: request.repoRoot,
      workingDirectory: request.repoRoot,
    };
    const branchNameLaunch = new RepositoryCommand(branchRequest).execute();
    if (branchNameLaunch.isErr()) return err(branchNameLaunch.error);
    const branchName = branchNameLaunch.value.stdout.trim();
    const reflogLaunch = new RepositoryCommand(reflogRequest).execute();
    if (reflogLaunch.isErr()) return err(reflogLaunch.error);
    const reflog = reflogLaunch.value.stdout;
    const taskAnchorSelection: TaskAnchorSelection = {
      currentCommit: gitCommit,
      branchName,
      reflog,
    };
    const taskAnchorCommit = new TaskAnchorHistory(
      taskAnchorSelection,
    ).commit();

    const directoryParts: AgentTempDirectoryParts = {
      repoRoot: request.repoRoot,
      taskAnchorCommit,
      osTempDirectory: tmpdir(),
    };
    const agentTempDirectory = new AgentTemporaryDirectory(
      directoryParts,
    ).path();
    const directoryOptions: { readonly recursive: true } = { recursive: true };
    try {
      mkdirSync(agentTempDirectory, directoryOptions);
    } catch {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: 'Could not create the agent temporary directory',
      });
    }
    const expanded = request.authoredPath.replaceAll(
      AGENT_TEMP_DIR_TOKEN,
      agentTempDirectory,
    );
    return ok(path.resolve(expanded));
  }
}

export type AgentTempDirectoryParts = {
  readonly repoRoot: string;
  readonly taskAnchorCommit: string;
  readonly osTempDirectory: string;
};

export type ResolveAgentTempPathRequest = {
  readonly repoRoot: string;
  readonly authoredPath: string;
};

export type TaskAnchorSelection = {
  readonly currentCommit: string;
  readonly branchName: string;
  readonly reflog: string;
};

export type AgentTemporaryPathFailure = {
  readonly code: LoomFailureCode;
  readonly message: string;
};
