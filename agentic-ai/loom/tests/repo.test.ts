import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { findRepoRoot, resolveRequestPath } from '../src/lib/repo.ts';
import { ResultKind } from '../src/result.ts';

describe('resolveRequestPath', () => {
  test('keeps absolute paths', () => {
    const absolute = '/tmp/request.yaml';
    const resolved = resolveRequestPath(absolute);
    expect(resolved.kind).toBe(ResultKind.Ok);
    if (resolved.kind === ResultKind.Ok) {
      expect(resolved.value).toBe(absolute);
    }
  });

  test('resolves relative paths from repository root', () => {
    const root = findRepoRoot();
    expect(root.kind).toBe(ResultKind.Ok);
    if (root.kind !== ResultKind.Ok) {
      return;
    }
    const relative = 'agentic-ai/loom/params/pre-push/default.yaml';
    const resolved = resolveRequestPath(
      relative,
      path.join(root.value, 'agentic-ai/loom'),
    );
    expect(resolved.kind).toBe(ResultKind.Ok);
    if (resolved.kind === ResultKind.Ok) {
      expect(resolved.value).toBe(path.join(root.value, relative));
    }
  });
});
