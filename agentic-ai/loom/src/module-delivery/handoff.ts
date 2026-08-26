import { isValidTaskResourceClaim } from '../agent-workflow/domain.ts';
import { gitText, runModuleDeliveryGit } from './git-command.ts';
import {
  CANONICAL_GIT_PATH,
  EXACT_GIT_COMMIT,
  canonicalGitPath,
} from './workspace-paths.ts';
import {
  assertModuleWorktreeClean,
  assertPreparedModuleWorktreeIdentity,
} from './workspace.ts';

import type { GitCommandRequest } from './git-command.ts';
import type { ModuleWorktreeHandle } from './workspace.ts';

export type VerifyModuleCommitHandoffRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly baselineCommit: string;
  readonly allowedWriteClaims: readonly string[];
};

export type VerifiedModuleCommitHandoff = {
  readonly taskId: string;
  readonly attempt: number;
  readonly planDigest: string;
  readonly baselineCommit: string;
  readonly commit: string;
  readonly changedPaths: readonly string[];
};

type ResourcePathMatchRequest = {
  readonly claim: string;
  readonly path: string;
};

type TreeEntryInspection = {
  readonly workspacePath: string;
  readonly commit: string;
  readonly path: string;
};

type ParsedTreeEntry = {
  readonly mode: string;
  readonly path: string;
};

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
};

type BasenamePatternMatch = {
  readonly pattern: string;
  readonly basename: string;
};

function gitRequest(invocation: ModuleGitInvocation): GitCommandRequest {
  return { cwd: invocation.cwd, args: invocation.args };
}

function decodeNullSeparatedGitPaths(bytes: Buffer): readonly string[] {
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    const encoded = bytes.subarray(start, index);
    if (encoded.length > 0) {
      const path = encoded.toString('utf8');
      if (!Buffer.from(path, 'utf8').equals(encoded)) {
        throw new Error('Changed Git path is not valid UTF-8.');
      }
      canonicalGitPath(path);
      paths.push(path);
    }
    start = index + 1;
  }
  if (start !== bytes.length) {
    throw new Error('Changed Git paths require NUL termination.');
  }
  return paths;
}

function wildcardBasenameMatches(match: BasenamePatternMatch): boolean {
  if (match.pattern === '*') return match.basename.length > 0;
  if (!match.pattern.startsWith('*.')) return match.pattern === match.basename;
  return match.basename.endsWith(match.pattern.slice(1));
}

function resourceClaimMatchesPath(request: ResourcePathMatchRequest): boolean {
  if (request.claim.startsWith('git:')) return false;
  if (!isValidTaskResourceClaim(request.claim)) return false;
  if (request.claim.endsWith('/**')) {
    const root = request.claim.slice(0, -3);
    return request.path === root || request.path.startsWith(`${root}/`);
  }
  if (request.claim.startsWith('**/')) {
    const pattern = request.claim.slice(3);
    const slash = request.path.lastIndexOf('/');
    const basename = request.path.slice(slash + 1);
    const match: BasenamePatternMatch = { pattern, basename };
    return wildcardBasenameMatches(match);
  }
  const lastSlash = request.claim.lastIndexOf('/');
  const basenamePattern = request.claim.slice(lastSlash + 1);
  if (basenamePattern.startsWith('*')) {
    const parent = request.claim.slice(0, lastSlash);
    const pathSlash = request.path.lastIndexOf('/');
    const pathParent = pathSlash === -1 ? '' : request.path.slice(0, pathSlash);
    const pathBasename = request.path.slice(pathSlash + 1);
    const match: BasenamePatternMatch = {
      pattern: basenamePattern,
      basename: pathBasename,
    };
    return pathParent === parent && wildcardBasenameMatches(match);
  }
  return request.path === request.claim;
}

function validateClaims(claims: readonly string[]): void {
  if (claims.length === 0) {
    throw new Error(
      'Commit handoff requires at least one allowed write claim.',
    );
  }
  for (const claim of claims) {
    if (!isValidTaskResourceClaim(claim) || claim.startsWith('git:')) {
      throw new Error(`Commit handoff has an invalid write claim: ${claim}.`);
    }
  }
}

function assertSafeTreeEntry(inspection: TreeEntryInspection): void {
  const invocation: ModuleGitInvocation = {
    cwd: inspection.workspacePath,
    args: ['ls-tree', '-z', inspection.commit, '--', inspection.path],
  };
  const entry = runModuleDeliveryGit(gitRequest(invocation)).stdout;
  if (entry.length === 0) return;
  const firstSpace = entry.indexOf(0x20);
  const mode =
    firstSpace === -1 ? '' : entry.subarray(0, firstSpace).toString('ascii');
  if (mode === '120000') {
    throw new Error(`Commit handoff cannot write symlink ${inspection.path}.`);
  }
  if (mode === '160000') {
    throw new Error(`Commit handoff cannot write gitlink ${inspection.path}.`);
  }
}

function parseRecursiveTree(bytes: Buffer): readonly ParsedTreeEntry[] {
  const entries: ParsedTreeEntry[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    const encoded = bytes.subarray(start, index);
    const tab = encoded.indexOf(0x09);
    const firstSpace = encoded.indexOf(0x20);
    if (encoded.length === 0 || tab < 0 || firstSpace < 0) {
      throw new Error('Baseline tree contains malformed entry data.');
    }
    const encodedPath = encoded.subarray(tab + 1);
    const path = encodedPath.toString('utf8');
    if (!Buffer.from(path, 'utf8').equals(encodedPath)) {
      throw new Error('Baseline Git path is not valid UTF-8.');
    }
    canonicalGitPath(path);
    const entry: ParsedTreeEntry = {
      mode: encoded.subarray(0, firstSpace).toString('ascii'),
      path,
    };
    entries.push(entry);
    start = index + 1;
  }
  if (start !== bytes.length) {
    throw new Error('Baseline tree entries require NUL termination.');
  }
  return entries;
}

function assertBaselineClaimsSafe(
  request: VerifyModuleCommitHandoffRequest,
): void {
  const invocation: ModuleGitInvocation = {
    cwd: request.workspace.worktreePath,
    args: ['ls-tree', '-r', '-z', request.baselineCommit, '--'],
  };
  const entries = parseRecursiveTree(
    runModuleDeliveryGit(gitRequest(invocation)).stdout,
  );
  for (const entry of entries) {
    const claimed = request.allowedWriteClaims.some((claim) => {
      const matchRequest: ResourcePathMatchRequest = {
        claim,
        path: entry.path,
      };
      return resourceClaimMatchesPath(matchRequest);
    });
    if (!claimed) continue;
    if (entry.mode === '120000') {
      throw new Error(
        `Writable baseline cannot contain symlink ${entry.path}.`,
      );
    }
    if (entry.mode === '160000') {
      throw new Error(
        `Writable baseline cannot contain gitlink ${entry.path}.`,
      );
    }
  }
}

export function verifyModuleCommitHandoff(
  request: VerifyModuleCommitHandoffRequest,
): VerifiedModuleCommitHandoff {
  if (
    !EXACT_GIT_COMMIT.test(request.baselineCommit) ||
    request.baselineCommit !== request.workspace.baselineCommit
  ) {
    throw new Error('Commit handoff baseline does not match its workspace.');
  }
  validateClaims(request.allowedWriteClaims);
  assertPreparedModuleWorktreeIdentity(request.workspace);
  assertModuleWorktreeClean(request.workspace);
  assertBaselineClaimsSafe(request);

  const headInvocation: ModuleGitInvocation = {
    cwd: request.workspace.worktreePath,
    args: ['rev-parse', '--verify', 'HEAD^{commit}'],
  };
  const commit = gitText(runModuleDeliveryGit(gitRequest(headInvocation)));
  if (!EXACT_GIT_COMMIT.test(commit) || commit === request.baselineCommit) {
    throw new Error('Commit handoff requires one non-baseline commit.');
  }
  const parentsInvocation: ModuleGitInvocation = {
    cwd: request.workspace.worktreePath,
    args: ['rev-list', '--parents', '-n', '1', commit],
  };
  const commitAndParents = gitText(
    runModuleDeliveryGit(gitRequest(parentsInvocation)),
  ).split(' ');
  if (
    commitAndParents.length !== 2 ||
    commitAndParents[0] !== commit ||
    commitAndParents[1] !== request.baselineCommit
  ) {
    throw new Error(
      'Commit handoff must be one direct-child non-merge commit.',
    );
  }
  const countInvocation: ModuleGitInvocation = {
    cwd: request.workspace.worktreePath,
    args: ['rev-list', '--count', `${request.baselineCommit}..${commit}`],
  };
  if (gitText(runModuleDeliveryGit(gitRequest(countInvocation))) !== '1') {
    throw new Error('Commit handoff must contain exactly one commit.');
  }
  const pathsInvocation: ModuleGitInvocation = {
    cwd: request.workspace.worktreePath,
    args: [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      request.baselineCommit,
      commit,
      '--',
    ],
  };
  const changedPaths = decodeNullSeparatedGitPaths(
    runModuleDeliveryGit(gitRequest(pathsInvocation)).stdout,
  );
  if (changedPaths.length === 0) {
    throw new Error('Commit handoff commit must be nonempty.');
  }
  for (const path of changedPaths) {
    if (!CANONICAL_GIT_PATH.test(path)) {
      throw new Error(`Commit handoff path is noncanonical: ${path}.`);
    }
    const matched = request.allowedWriteClaims.some((claim) => {
      const matchRequest: ResourcePathMatchRequest = { claim, path };
      return resourceClaimMatchesPath(matchRequest);
    });
    if (!matched) {
      throw new Error(
        `Commit handoff path is outside allowed write claims: ${path}.`,
      );
    }
    const baselineInspection: TreeEntryInspection = {
      workspacePath: request.workspace.worktreePath,
      commit: request.baselineCommit,
      path,
    };
    assertSafeTreeEntry(baselineInspection);
    const handoffInspection: TreeEntryInspection = {
      workspacePath: request.workspace.worktreePath,
      commit,
      path,
    };
    assertSafeTreeEntry(handoffInspection);
  }
  return {
    taskId: request.workspace.taskId,
    attempt: request.workspace.attempt,
    planDigest: request.workspace.planDigest,
    baselineCommit: request.baselineCommit,
    commit,
    changedPaths,
  };
}
