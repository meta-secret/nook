import { existsSync } from 'node:fs';

import path from 'node:path';

import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

export class RepositoryRoot {
  private constructor(private readonly directory: string) {}
  static find(startDir: string = process.cwd()): string {
    return new RepositoryRoot(startDir).locate();
  }
  private locate(): string {
    const startDir = this.directory;
    let current = path.resolve(startDir);
    for (;;) {
      if (existsSync(path.join(current, '.cortex', 'AGENTS.md'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        LoomFailure.raise(LoomFailureCode.RepoRootNotFound);
      }
      current = parent;
    }
  }
  static resolveRequestPath(args: ResolveRequestPathArgs): string {
    const requestPath = args.requestPath;
    const startDir = 'startDir' in args ? args.startDir : process.cwd();

    if (path.isAbsolute(requestPath)) {
      return requestPath;
    }
    const root = RepositoryRoot.find(startDir);
    return path.resolve(root, requestPath);
  }
}

export class BunExecutable {
  private constructor(readonly path: string) {}
  static require(): string {
    const bunPath = Bun.which('bun');
    if (typeof bunPath !== 'string' || bunPath.length === 0) {
      LoomFailure.raise(LoomFailureCode.BunNotFound);
    }
    return new BunExecutable(bunPath).path;
  }
}

export type ResolveRequestPathArgs =
  | { readonly requestPath: string }
  | { readonly requestPath: string; readonly startDir: string };
