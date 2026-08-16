import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeAgentStatsAssemblePayload } from '../src/codec/args/agent-stats.ts';
import { decodePrePushRequest } from '../src/codec/args/pre-push.ts';
import { RequestFamily, ResponsePhase } from '../src/codec/enums.ts';
import { DecodeStatus } from '../src/codec/field-error.ts';
import { decodeLoomRequest } from '../src/codec/request.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';
import { findRepoRoot } from '../src/lib/repo.ts';

import type { DecodeAgentStatsAssemblePayloadArgs } from '../src/codec/args/agent-stats.ts';
describe('loom domain request codec', () => {
  test('decodes a valid prePush request', () => {
    const decodedArgs6 = {
      prePush: { stageHostUpdates: true, fetchOriginMain: true },
    };
    const decoded = decodeLoomRequest(decodedArgs6);
    expect(decoded.status).toBe(DecodeStatus.Ok);
    if (decoded.status === DecodeStatus.Ok) {
      expect(decoded.value.family).toBe(RequestFamily.PrePush);
    }
  });

  test('decodes nested agentStats.assemble request', () => {
    const decodedArgs5 = {
      agentStats: {
        assemble: {
          prNumber: 12,
          scratchPath: '/tmp/a.json',
          outputPath: '/tmp/12.yaml',
          includeTestInventory: false,
        },
      },
    };
    const decoded = decodeLoomRequest(decodedArgs5);
    expect(decoded.status).toBe(DecodeStatus.Ok);
    if (decoded.status === DecodeStatus.Ok) {
      expect(decoded.value.family).toBe(RequestFamily.AgentStats);
    }
  });

  test('rejects generic arguments envelopes', () => {
    const decodedArgs4 = {
      name: 'agent-stats',
      arguments: { action: 'assemble', pr: 123 },
    };
    const decoded = decodeLoomRequest(decodedArgs4);
    expect(decoded.status).toBe(DecodeStatus.Failed);
    if (decoded.status === DecodeStatus.Failed) {
      expect(decoded.errors.some((entry) => entry.path === 'name')).toBe(true);
      expect(decoded.errors.some((entry) => entry.path === 'arguments')).toBe(
        true,
      );
    }
  });

  test('rejects wrong prePush field types', () => {
    const decodedArgs3 = {
      stageHostUpdates: 'yes',
      fetchOriginMain: true,
    };
    const decoded = decodePrePushRequest(decodedArgs3);
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
    const decodedArgs2: DecodeAgentStatsAssemblePayloadArgs = {
      value: {
        prNumber: 12,
        scratchPath: '/tmp/a.json',
        outputPath: '/tmp/12.yaml',
        includeTestInventory: false,
      },
      path: 'agentStats.assemble',
    };
    const decoded = decodeAgentStatsAssemblePayload(decodedArgs2);
    expect(decoded.status).toBe(DecodeStatus.Ok);
  });

  test('rejects unknown agentStats assemble fields', () => {
    const decodedArgs: DecodeAgentStatsAssemblePayloadArgs = {
      value: {
        prNumber: 12,
        scratchPath: '/tmp/a.json',
        outputPath: '/tmp/12.yaml',
        includeTestInventory: false,
        action: 'assemble',
      },
      path: 'agentStats.assemble',
    };
    const decoded = decodeAgentStatsAssemblePayload(decodedArgs);
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
    const outcomeArgs3 = {
      toolsList: {},
    };
    const outcome = await dispatchValue(outcomeArgs3);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.body.ok).toBe(true);
    if (outcome.body.ok) {
      const result = outcome.body.result as {
        requests: readonly {
          family: RequestFamily;
          exampleRequest: string;
          exampleYaml: string;
        }[];
      };
      expect(
        result.requests.some((entry) => entry.family === RequestFamily.PrePush),
      ).toBe(true);
      expect(
        result.requests.some(
          (entry) => entry.family === RequestFamily.ToolsCall,
        ),
      ).toBe(false);
      for (const entry of result.requests) {
        const absoluteExamplePath = path.join(
          findRepoRoot(),
          entry.exampleRequest,
        );
        expect(entry.exampleYaml).toBe(
          readFileSync(absoluteExamplePath, 'utf8'),
        );
      }
    }
  });

  test('unknown root key returns decode errors', async () => {
    const outcomeArgs2 = {
      notARequest: {},
    };
    const outcome = await dispatchValue(outcomeArgs2);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe(ResponsePhase.Decode);
      expect(outcome.body.recover.toolsListRequest).toContain('tools-list');
    }
  });

  test('toolsCall nests into prePush decode errors', async () => {
    const outcomeArgs = {
      toolsCall: {
        prePush: { stageHostUpdates: true },
      },
    };
    const outcome = await dispatchValue(outcomeArgs);
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
