import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from './run.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';

import type { RunCommandArgs } from './run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export const AGENT_TEMP_DIR_TOKEN = '{agentTempDir}';

const AGENT_TEMP_DIRECTORY_NAME = 'nook-agent-stats';
const WORKTREE_ID_LENGTH = 16;

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

export function buildAgentTempDirectory(
  parts: AgentTempDirectoryParts,
): string {
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

export function selectTaskAnchorCommit(selection: TaskAnchorSelection): string {
  const checkoutSuffix = ` to ${selection.branchName}`;
  const lines = selection.reflog.split('\n');
  for (const line of lines) {
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
    const line = lines[index] ?? '';
    const [commit = ''] = line.split('\t', 1);
    if (/^[0-9a-f]{40}$/.test(commit)) {
      return commit;
    }
  }
  return selection.currentCommit;
}

export function resolveAgentTempPath(
  request: ResolveAgentTempPathRequest,
): string {
  if (!request.authoredPath.includes(AGENT_TEMP_DIR_TOKEN)) {
    return path.resolve(request.authoredPath);
  }

  const gitHeadRequest: RunCommandArgs = {
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: request.repoRoot,
  };
  const gitHead = runCommand(gitHeadRequest);
  const gitCommit = gitHead.stdout.trim();
  if (gitHead.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(gitCommit)) {
    const failure: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: 'Could not resolve the exact Git commit for {agentTempDir}',
    };
    loomFailureDetail(failure);
  }

  const branchRequest: RunCommandArgs = {
    command: 'git',
    args: ['branch', '--show-current'],
    cwd: request.repoRoot,
  };
  const reflogRequest: RunCommandArgs = {
    command: 'git',
    args: ['reflog', '--format=%H%x09%gs', 'HEAD'],
    cwd: request.repoRoot,
  };
  const branchName = runCommand(branchRequest).stdout.trim();
  const reflog = runCommand(reflogRequest).stdout;
  const taskAnchorSelection: TaskAnchorSelection = {
    currentCommit: gitCommit,
    branchName,
    reflog,
  };
  const taskAnchorCommit = selectTaskAnchorCommit(taskAnchorSelection);

  const directoryParts: AgentTempDirectoryParts = {
    repoRoot: request.repoRoot,
    taskAnchorCommit,
    osTempDirectory: tmpdir(),
  };
  const agentTempDirectory = buildAgentTempDirectory(directoryParts);
  const expanded = request.authoredPath.replaceAll(
    AGENT_TEMP_DIR_TOKEN,
    agentTempDirectory,
  );
  return path.resolve(expanded);
}
