import { existsSync } from 'node:fs';
import path from 'node:path';
import { ResultKind, err, ok, type Result } from '../result.ts';

export function findRepoRoot(startDir: string = process.cwd()): Result<string> {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, '.cortex', 'AGENTS.md'))) {
      return ok(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return err(
        'Could not find Nook repository root from the current directory',
      );
    }
    current = parent;
  }
}

/** Resolve request YAML paths against the repository root (Task CONFIG convention). */
export function resolveRequestPath(
  requestPath: string,
  startDir: string = process.cwd(),
): Result<string> {
  if (path.isAbsolute(requestPath)) {
    return ok(requestPath);
  }
  const root = findRepoRoot(startDir);
  if (root.kind === ResultKind.Err) {
    return root;
  }
  return ok(path.resolve(root.value, requestPath));
}

export function requireBun(): Result<string> {
  const bunPath = Bun.which('bun');
  if (typeof bunPath !== 'string' || bunPath.length === 0) {
    return err(
      'Bun is not installed or not on PATH. Install Bun, then re-run Loom.',
    );
  }
  return ok(bunPath);
}
