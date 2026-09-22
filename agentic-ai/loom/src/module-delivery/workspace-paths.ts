import { lstatSync, realpathSync } from 'node:fs';

import { dirname, isAbsolute, relative, resolve } from 'node:path';

export class CanonicalDirectory {
  private constructor(private readonly request: CanonicalDirectoryRequest) {}
  static resolve(request: CanonicalDirectoryRequest): string {
    return new CanonicalDirectory(request).execute();
  }
  private execute(): string {
    const request = this.request;
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
}

export class DirectorySeparation {
  private constructor(private readonly request: DisjointPathsRequest) {}
  static matches(request: DisjointPathsRequest): void {
    return new DirectorySeparation(request).execute();
  }
  private execute(): void {
    const request = this.request;
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
}

export class DirectChildDirectory {
  private constructor(private readonly request: StrictChildPathRequest) {}
  static matches(request: StrictChildPathRequest): boolean {
    return new DirectChildDirectory(request).execute();
  }
  private execute(): boolean {
    const request = this.request;
    return (
      dirname(request.child) === request.parent &&
      request.child !== request.parent
    );
  }
}

export class CanonicalGitPath {
  private constructor(private readonly request: string) {}
  static resolve(path: string): void {
    return new CanonicalGitPath(path).execute();
  }
  private execute(): void {
    const path = this.request;
    if (!CANONICAL_GIT_PATH.test(path) || path.includes('\\')) {
      throw new Error(
        `Changed Git path is noncanonical: ${JSON.stringify(path)}.`,
      );
    }
  }
}

export class FilesystemPathPresence {
  private constructor(private readonly request: string) {}
  static exists(path: string): boolean {
    return new FilesystemPathPresence(path).execute();
  }
  private execute(): boolean {
    const path = this.request;
    try {
      lstatSync(path);
      return true;
    } catch {
      return false;
    }
  }
}

export const EXACT_GIT_COMMIT = /^[0-9a-f]{40}$/u;

export const EXACT_PLAN_DIGEST = /^[0-9a-f]{64}$/u;

export const CANONICAL_TASK_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

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
