import { err, ok, type Result } from 'neverthrow';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LoomFailureCode } from '../loom-failure.ts';

export type RepositoryDiscoveryFailure = {
  readonly code: LoomFailureCode;
  readonly message: string;
};

export class RepositoryRoot {
  constructor(private readonly directory: string = process.cwd()) {}

  locate(): Result<string, RepositoryDiscoveryFailure> {
    let current = path.resolve(this.directory);
    for (;;) {
      if (existsSync(path.join(current, '.cortex', 'AGENTS.md')))
        return ok(current);
      const parent = path.dirname(current);
      if (parent === current)
        return err({
          code: LoomFailureCode.RepoRootNotFound,
          message:
            'Could not find Nook repository root from the current directory',
        });
      current = parent;
    }
  }
}

export class RepositoryRequestPath {
  constructor(private readonly request: ResolveRequestPathArgs) {}

  resolve(): Result<string, RepositoryDiscoveryFailure> {
    const { requestPath } = this.request;
    if (path.isAbsolute(requestPath)) return ok(requestPath);
    return new RepositoryRoot(
      'startDir' in this.request ? this.request.startDir : process.cwd(),
    )
      .locate()
      .map((root) => path.resolve(root, requestPath));
  }
}

export class BunExecutable {
  private constructor(readonly path: string) {}

  static discover(): Result<BunExecutable, RepositoryDiscoveryFailure> {
    const bunPath = Bun.which('bun');
    if (typeof bunPath !== 'string' || bunPath.length === 0)
      return err({
        code: LoomFailureCode.BunNotFound,
        message:
          'Bun is not installed or not on PATH. Install Bun, then re-run Loom.',
      });
    return ok(new BunExecutable(bunPath));
  }
}

export type ResolveRequestPathArgs =
  | { readonly requestPath: string }
  | { readonly requestPath: string; readonly startDir: string };
