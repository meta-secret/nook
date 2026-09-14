import { describe, expect, test } from 'bun:test';
import { CliInvocationKind, LoomCommandLine } from '../src/cli-invocation.ts';

import type { ParseCliInvocationArgs } from '../src/cli-invocation.ts';

describe('parseCliInvocation', () => {
  test('treats a single path as a request file', () => {
    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: ['/tmp/request.yaml'],
    };
    const invocation = LoomCommandLine.parse(parseCliInvocationArgs);
    expect(invocation.kind).toBe(CliInvocationKind.RequestFile);
    if (invocation.kind === CliInvocationKind.RequestFile) {
      expect(invocation.requestPath).toBe('/tmp/request.yaml');
    }
  });

  test('rejects the retired prePush default', () => {
    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: ['--default', 'prePush'],
    };
    const invocation = LoomCommandLine.parse(parseCliInvocationArgs);
    expect(invocation.kind).toBe(CliInvocationKind.UsageError);
    if (invocation.kind === CliInvocationKind.UsageError)
      expect(invocation.message).toContain('toolsList');
  });

  test('rejects a parameterized family as a default', () => {
    const parseCliInvocationArgs: ParseCliInvocationArgs = {
      argv: ['--default', 'skillScaffold'],
    };
    const invocation = LoomCommandLine.parse(parseCliInvocationArgs);
    expect(invocation.kind).toBe(CliInvocationKind.UsageError);
  });
});
