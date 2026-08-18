import { describe, expect, test } from 'bun:test';
import {
  CliInvocationKind,
  parseCliInvocation,
} from '../src/cli-invocation.ts';
import { RequestFamily } from '../src/codec/enums.ts';
import { ExampleDispatchKind } from '../src/codec/example-documents.ts';

import type { ParseCliInvocationArgs } from '../src/cli-invocation.ts';

describe('parseCliInvocation', () => {
  test('treats a single path as a request file', () => {
    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: ['/tmp/request.yaml'],
    };
    const invocation = parseCliInvocation(parseCliInvocationArgs);
    expect(invocation.kind).toBe(CliInvocationKind.RequestFile);
    if (invocation.kind === CliInvocationKind.RequestFile) {
      expect(invocation.requestPath).toBe('/tmp/request.yaml');
    }
  });

  test('accepts a defaultable family', () => {
    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: ['--default', 'prePush'],
    };
    const invocation = parseCliInvocation(parseCliInvocationArgs);
    expect(invocation.kind).toBe(CliInvocationKind.DefaultFamily);
    if (invocation.kind === CliInvocationKind.DefaultFamily) {
      expect(invocation.entry.family).toBe(RequestFamily.PrePush);
      expect(invocation.entry.dispatch).toBe(ExampleDispatchKind.Defaultable);
    }
  });

  test('rejects a parameterized family as a default', () => {
    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: ['--default', 'skillScaffold'],
    };
    const invocation = parseCliInvocation(parseCliInvocationArgs);
    expect(invocation.kind).toBe(CliInvocationKind.UsageError);
  });
});
