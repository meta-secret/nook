import { describe, expect, test } from 'bun:test';
import { decodeAgentStatsAssembleRequest } from '../src/codec/args/agent-stats.ts';
import { decodePrePushRequest } from '../src/codec/args/pre-push.ts';
import { RequestKind, ResponsePhase } from '../src/codec/enums.ts';
import { decodeLoomRequest } from '../src/codec/request.ts';
import { ResultKind } from '../src/result.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';

describe('loom domain request codec', () => {
  test('decodes a valid prePush request', () => {
    const decoded = decodeLoomRequest({
      prePush: { stageHostUpdates: true, fetchOriginMain: true },
    });
    expect(decoded.kind).toBe(ResultKind.Ok);
    if (decoded.kind === ResultKind.Ok) {
      expect(decoded.value.kind).toBe(RequestKind.PrePush);
    }
  });

  test('rejects generic arguments envelopes', () => {
    const decoded = decodeLoomRequest({
      name: 'agent-stats',
      arguments: { action: 'assemble', pr: 123 },
    });
    expect(decoded.kind).toBe(ResultKind.Err);
    if (decoded.kind === ResultKind.Err) {
      expect(decoded.errors.some((entry) => entry.path === 'name')).toBe(true);
      expect(decoded.errors.some((entry) => entry.path === 'arguments')).toBe(
        true,
      );
    }
  });

  test('rejects wrong prePush field types', () => {
    const decoded = decodePrePushRequest({
      stageHostUpdates: 'yes',
      fetchOriginMain: true,
    });
    expect(decoded.kind).toBe(ResultKind.Err);
    if (decoded.kind === ResultKind.Err) {
      expect(
        decoded.errors.some(
          (entry) => entry.path === 'prePush.stageHostUpdates',
        ),
      ).toBe(true);
    }
  });

  test('decodes agentStatsAssemble request', () => {
    const decoded = decodeAgentStatsAssembleRequest({
      prNumber: 12,
      scratchPath: '/tmp/a.json',
      outputPath: '/tmp/12.yaml',
      includeTestInventory: false,
    });
    expect(decoded.kind).toBe(ResultKind.Ok);
  });

  test('rejects unknown agentStatsAssemble fields', () => {
    const decoded = decodeAgentStatsAssembleRequest({
      prNumber: 12,
      scratchPath: '/tmp/a.json',
      outputPath: '/tmp/12.yaml',
      includeTestInventory: false,
      action: 'assemble',
    });
    expect(decoded.kind).toBe(ResultKind.Err);
    if (decoded.kind === ResultKind.Err) {
      expect(
        decoded.errors.some(
          (entry) => entry.path === 'agentStatsAssemble.action',
        ),
      ).toBe(true);
    }
  });
});

describe('loom dispatch protocol', () => {
  test('toolsList returns discoverable domain requests', async () => {
    const outcome = await dispatchValue({
      toolsList: {},
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.body.ok).toBe(true);
    if (outcome.body.ok) {
      const result = outcome.body.result as {
        requests: readonly { requestKind: RequestKind }[];
      };
      expect(
        result.requests.some(
          (entry) => entry.requestKind === RequestKind.PrePush,
        ),
      ).toBe(true);
      expect(
        result.requests.some(
          (entry) => entry.requestKind === RequestKind.ToolsCall,
        ),
      ).toBe(false);
    }
  });

  test('unknown root key returns decode errors', async () => {
    const outcome = await dispatchValue({
      notARequest: {},
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe(ResponsePhase.Decode);
      expect(outcome.body.recover.toolsListRequest).toContain('tools-list');
    }
  });

  test('toolsCall nests into prePush decode errors', async () => {
    const outcome = await dispatchValue({
      toolsCall: {
        prePush: { stageHostUpdates: true },
      },
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe(ResponsePhase.Decode);
      expect(
        outcome.body.errors.some(
          (entry) => entry.path === 'prePush.fetchOriginMain',
        ),
      ).toBe(true);
    }
  });
});
