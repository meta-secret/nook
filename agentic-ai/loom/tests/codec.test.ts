import { describe, expect, test } from 'bun:test';
import { decodeAgentStatsArgs } from '../src/codec/args/agent-stats.ts';
import { decodePrePushArgs } from '../src/codec/args/pre-push.ts';
import { decodeLoomRequest } from '../src/codec/request.ts';
import { ResultKind } from '../src/result.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';

describe('loom request codec', () => {
  test('decodes a valid envelope', () => {
    const decoded = decodeLoomRequest({
      name: 'pre-push',
      arguments: { stage: true, fetch: true },
    });
    expect(decoded.kind).toBe(ResultKind.Ok);
    if (decoded.kind === ResultKind.Ok) {
      expect(decoded.value.name).toBe('pre-push');
    }
  });

  test('rejects unknown top-level fields', () => {
    const decoded = decodeLoomRequest({
      name: 'pre-push',
      arguments: {},
      extra: true,
    });
    expect(decoded.kind).toBe(ResultKind.Err);
    if (decoded.kind === ResultKind.Err) {
      expect(decoded.errors.some((entry) => entry.path === 'extra')).toBe(true);
    }
  });

  test('rejects wrong pre-push argument types', () => {
    const decoded = decodePrePushArgs({ stage: 'yes', fetch: true });
    expect(decoded.kind).toBe(ResultKind.Err);
    if (decoded.kind === ResultKind.Err) {
      expect(
        decoded.errors.some((entry) => entry.path === 'arguments.stage'),
      ).toBe(true);
    }
  });

  test('decodes agent-stats assemble args', () => {
    const decoded = decodeAgentStatsArgs({
      action: 'assemble',
      pr: 12,
      scratch: '/tmp/a.json',
      out: '/tmp/12.yaml',
      inventory: false,
    });
    expect(decoded.kind).toBe(ResultKind.Ok);
  });

  test('rejects unknown agent-stats fields for validate', () => {
    const decoded = decodeAgentStatsArgs({
      action: 'validate',
      file: '/tmp/12.yaml',
      inventory: true,
    });
    expect(decoded.kind).toBe(ResultKind.Err);
    if (decoded.kind === ResultKind.Err) {
      expect(
        decoded.errors.some((entry) => entry.path === 'arguments.inventory'),
      ).toBe(true);
    }
  });
});

describe('loom dispatch protocol', () => {
  test('tools-list returns discoverable tools', async () => {
    const outcome = await dispatchValue({
      name: 'tools-list',
      arguments: {},
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.body.ok).toBe(true);
    if (outcome.body.ok) {
      const result = outcome.body.result as {
        tools: readonly { name: string }[];
      };
      expect(result.tools.some((tool) => tool.name === 'pre-push')).toBe(true);
      expect(result.tools.some((tool) => tool.name === 'tools-call')).toBe(
        false,
      );
    }
  });

  test('unknown tool returns exit 2 with recover hint', async () => {
    const outcome = await dispatchValue({
      name: 'not-a-tool',
      arguments: {},
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe('unknown-tool');
      expect(outcome.body.recover.toolsListRequest).toContain('tools-list');
    }
  });

  test('tools-call nests into pre-push decode errors', async () => {
    const outcome = await dispatchValue({
      name: 'tools-call',
      arguments: {
        name: 'pre-push',
        arguments: { stage: true },
      },
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe('arguments');
      expect(
        outcome.body.errors.some((entry) => entry.path === 'arguments.fetch'),
      ).toBe(true);
    }
  });
});
