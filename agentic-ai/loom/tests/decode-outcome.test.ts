import { RepositoryRequestPath } from '../src/lib/repo.ts';
import assert from 'node:assert/strict';
import { describe, expect, test } from 'bun:test';
import {
  DecodeStatus,
  FieldIssue,
  FailedFieldDecode,
  SuccessfulFieldDecode,
  FieldDiagnostic,
  FieldDecodeInvariantViolation,
} from '../src/codec/field-error.ts';
import { RepositoryRoot } from '../src/lib/repo.ts';
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
    const outcome = SuccessfulFieldDecode.create(outcomeArgs);
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
    const outcome = FailedFieldDecode.create([
      FieldDiagnostic.create(fieldErrorArgs),
    ]);
    expect(outcome.status).toBe(DecodeStatus.Failed);
    if (outcome.status === DecodeStatus.Failed) {
      expect(outcome.errors).toHaveLength(1);
      for (const error of outcome.errors) {
        expect(error.issue).toBe(FieldIssue.ExpectedBoolean);
      }
    }
  });

  test('successful field decode owns guarded value access', () => {
    const success = SuccessfulFieldDecode.create({ ready: true });
    expect(SuccessfulFieldDecode.requireValue(success)).toEqual({
      ready: true,
    });

    const failure = FailedFieldDecode.create([
      FieldDiagnostic.create({
        path: 'prePush.stageHostUpdates',
        issue: FieldIssue.ExpectedBoolean,
      }),
    ]);
    expect(() => SuccessfulFieldDecode.requireValue(failure)).toThrow(
      FieldDecodeInvariantViolation,
    );
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
    const discovery1 = new RepositoryRequestPath(
      resolveRequestPathArgs,
    ).resolve();
    assert(discovery1.isOk());
    expect(discovery1.value).toBe(absolute);
  });

  test('resolves relative paths from repository root', () => {
    const discovery2 = new RepositoryRoot().locate();
    assert(discovery2.isOk());
    const root = discovery2.value;
    const relative = 'agentic-ai/loom/package.json';
    const resolvedArgs: ResolveRequestPathArgs = {
      requestPath: relative,
      startDir: `${root}/agentic-ai/loom`,
    };
    const discovery3 = new RepositoryRequestPath(resolvedArgs).resolve();
    assert(discovery3.isOk());
    const resolved = discovery3.value;
    expect(resolved.endsWith(relative)).toBe(true);
  });
});
