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

import type { FieldErrorArgs } from '../src/codec/field-error.ts';
import type { ResolveRequestPathArgs } from '../src/lib/repo.ts';
describe('decode outcome helpers', () => {
  test('decodeOk carries value', () => {
    const outcomeArgs = { ready: true };
    const outcome = decodeOk(outcomeArgs);
    expect(outcome.status).toBe(DecodeStatus.Ok);
    if (outcome.status === DecodeStatus.Ok) {
      expect(outcome.value.ready).toBe(true);
    }
  });

  test('decodeErr carries field errors', () => {
    const fieldErrorArgs: FieldErrorArgs = {
      path: 'prePush.stageHostUpdates',
      issue: FieldIssue.ExpectedBoolean,
    };
    const outcome = decodeErr([fieldError(fieldErrorArgs)]);
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
    const failureArgs = {
      code: LoomFailureCode.RepoRootNotFound,
      detail: {
        kind: LoomFailureDetailKind.Text,
        text: 'missing root',
      },
    };
    const failure = new LoomFailure(failureArgs);
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
    const resolveRequestPathArgs: ResolveRequestPathArgs = {
      requestPath: absolute,
    };
    expect(resolveRequestPath(resolveRequestPathArgs)).toBe(absolute);
  });

  test('resolves relative paths from repository root', () => {
    const root = findRepoRoot();
    const relative = 'agentic-ai/loom/package.json';
    const resolvedArgs: ResolveRequestPathArgs = {
      requestPath: relative,
      startDir: `${root}/agentic-ai/loom`,
    };
    const resolved = resolveRequestPath(resolvedArgs);
    expect(resolved.endsWith(relative)).toBe(true);
  });
});
