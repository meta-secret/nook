import { describe, expect, test } from 'bun:test';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldError,
} from '../src/codec/field-error.ts';
import { findRepoRoot, resolveRequestPath } from '../src/lib/repo.ts';
import {
  LoomFailure,
  LoomFailureCode,
  LoomFailureDetailKind,
} from '../src/loom-failure.ts';

describe('decode outcome helpers', () => {
  test('decodeOk carries value', () => {
    const outcome = decodeOk({ ready: true });
    expect(outcome.status).toBe(DecodeStatus.Ok);
    if (outcome.status === DecodeStatus.Ok) {
      expect(outcome.value.ready).toBe(true);
    }
  });

  test('decodeErr carries field errors', () => {
    const outcome = decodeErr([
      fieldError('prePush.stageHostUpdates', FieldIssue.ExpectedBoolean),
    ]);
    expect(outcome.status).toBe(DecodeStatus.Failed);
    if (outcome.status === DecodeStatus.Failed) {
      expect(outcome.errors).toHaveLength(1);
      for (const error of outcome.errors) {
        expect(error.issue).toBe(FieldIssue.ExpectedBoolean);
      }
    }
  });
});

describe('LoomFailure', () => {
  test('carries failure code and detail', () => {
    const failure = new LoomFailure(LoomFailureCode.RepoRootNotFound, {
      kind: LoomFailureDetailKind.Text,
      text: 'missing root',
    });
    expect(failure.code).toBe(LoomFailureCode.RepoRootNotFound);
    expect(failure.detail.kind).toBe(LoomFailureDetailKind.Text);
    if (failure.detail.kind === LoomFailureDetailKind.Text) {
      expect(failure.detail.text).toBe('missing root');
    }
  });
});

describe('resolveRequestPath', () => {
  test('keeps absolute paths', () => {
    const absolute = '/tmp/request.yaml';
    expect(resolveRequestPath(absolute)).toBe(absolute);
  });

  test('resolves relative paths from repository root', () => {
    const root = findRepoRoot();
    const relative = 'agentic-ai/loom/params/pre-push/default.yaml';
    const resolved = resolveRequestPath(relative, `${root}/agentic-ai/loom`);
    expect(resolved.endsWith(relative)).toBe(true);
  });
});
