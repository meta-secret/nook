import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const EXACT_GIT_COMMIT = /^[0-9a-f]{40}$/u;
export const EXACT_PLAN_DIGEST = /^[0-9a-f]{64}$/u;
export const CANONICAL_TASK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
export const CANONICAL_GIT_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;

export type CanonicalDirectoryRequest = {
  readonly path: string;
  readonly label: string;
};

export type StrictChildPathRequest = {
  readonly parent: string;
  readonly child: string;
};

export type DisjointPathsRequest = {
  readonly first: string;
  readonly second: string;
  readonly labels: string;
};

export function canonicalDirectory(request: CanonicalDirectoryRequest): string {
  if (!isAbsolute(request.path)) {
    throw new Error(`${request.label} must be an absolute path.`);
  }
  const resolved = resolve(request.path);
  const metadata = lstatSync(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${request.label} must be a real directory.`);
  }
  const canonical = realpathSync(resolved);
  if (canonical !== resolved) {
    throw new Error(`${request.label} must already be canonical.`);
  }
  return canonical;
}

export function pathsAreDisjoint(request: DisjointPathsRequest): void {
  const firstToSecond = relative(request.first, request.second);
  const secondToFirst = relative(request.second, request.first);
  if (
    firstToSecond === '' ||
    (!firstToSecond.startsWith('..') && !isAbsolute(firstToSecond)) ||
    (!secondToFirst.startsWith('..') && !isAbsolute(secondToFirst))
  ) {
    throw new Error(`${request.labels} must be disjoint.`);
  }
}

export function isStrictDirectChild(request: StrictChildPathRequest): boolean {
  return (
    dirname(request.child) === request.parent &&
    request.child !== request.parent
  );
}

export function canonicalGitPath(path: string): void {
  if (!CANONICAL_GIT_PATH.test(path) || path.includes('\\')) {
    throw new Error(
      `Changed Git path is noncanonical: ${JSON.stringify(path)}.`,
    );
  }
}

export function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
