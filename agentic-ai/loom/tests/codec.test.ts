import { describe, expect, test } from 'bun:test';
import { decodeAgentStatsAssemblePayload } from '../src/codec/args/agent-stats.ts';
import { decodePrePushRequest } from '../src/codec/args/pre-push.ts';
import { RequestFamily, ResponsePhase } from '../src/codec/enums.ts';
import { DecodeStatus } from '../src/codec/field-error.ts';
import { decodeLoomRequest } from '../src/codec/request.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';

describe('loom domain request codec', () => {
  test('decodes a valid prePush request', () => {
    const decoded = decodeLoomRequest({
      prePush: { stageHostUpdates: true, fetchOriginMain: true },
    });
    expect(decoded.status).toBe(DecodeStatus.Ok);
    if (decoded.status === DecodeStatus.Ok) {
      expect(decoded.value.family).toBe(RequestFamily.PrePush);
    }
  });

  test('decodes nested agentStats.assemble request', () => {
    const decoded = decodeLoomRequest({
      agentStats: {
        assemble: {
          prNumber: 12,
          scratchPath: '/tmp/a.json',
          outputPath: '/tmp/12.yaml',
          includeTestInventory: false,
        },
      },
    });
    expect(decoded.status).toBe(DecodeStatus.Ok);
    if (decoded.status === DecodeStatus.Ok) {
      expect(decoded.value.family).toBe(RequestFamily.AgentStats);
    }
  });

  test('rejects generic arguments envelopes', () => {
    const decoded = decodeLoomRequest({
      name: 'agent-stats',
      arguments: { action: 'assemble', pr: 123 },
    });
    expect(decoded.status).toBe(DecodeStatus.Failed);
    if (decoded.status === DecodeStatus.Failed) {
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
    expect(decoded.status).toBe(DecodeStatus.Failed);
    if (decoded.status === DecodeStatus.Failed) {
      expect(
        decoded.errors.some(
          (entry) => entry.path === 'prePush.stageHostUpdates',
        ),
      ).toBe(true);
    }
  });

  test('decodes agentStats assemble payload', () => {
    const decoded = decodeAgentStatsAssemblePayload(
      {
        prNumber: 12,
        scratchPath: '/tmp/a.json',
        outputPath: '/tmp/12.yaml',
        includeTestInventory: false,
      },
      'agentStats.assemble',
    );
    expect(decoded.status).toBe(DecodeStatus.Ok);
  });

  test('rejects unknown agentStats assemble fields', () => {
    const decoded = decodeAgentStatsAssemblePayload(
      {
        prNumber: 12,
        scratchPath: '/tmp/a.json',
        outputPath: '/tmp/12.yaml',
        includeTestInventory: false,
        action: 'assemble',
      },
      'agentStats.assemble',
    );
    expect(decoded.status).toBe(DecodeStatus.Failed);
    if (decoded.status === DecodeStatus.Failed) {
      expect(
        decoded.errors.some(
          (entry) => entry.path === 'agentStats.assemble.action',
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
        requests: readonly { family: RequestFamily }[];
      };
      expect(
        result.requests.some((entry) => entry.family === RequestFamily.PrePush),
      ).toBe(true);
      expect(
        result.requests.some(
          (entry) => entry.family === RequestFamily.ToolsCall,
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
