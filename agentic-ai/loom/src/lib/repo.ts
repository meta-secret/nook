import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, '.cortex', 'AGENTS.md'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      loomFailure(LoomFailureCode.RepoRootNotFound);
    }
    current = parent;
  }
}

/** Resolve request YAML paths against the repository root (Task CONFIG convention). */
export function resolveRequestPath(
  requestPath: string,
  startDir: string = process.cwd(),
): string {
  if (path.isAbsolute(requestPath)) {
    return requestPath;
  }
  const root = findRepoRoot(startDir);
  return path.resolve(root, requestPath);
}

export function requireBun(): string {
  const bunPath = Bun.which('bun');
  if (typeof bunPath !== 'string' || bunPath.length === 0) {
    loomFailure(LoomFailureCode.BunNotFound);
  }
  return bunPath;
}
