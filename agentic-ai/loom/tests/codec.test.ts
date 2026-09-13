import { describe, expect, test } from 'bun:test';
import { RequestFamily, ResponsePhase } from '../src/codec/enums.ts';
import { DecodeStatus } from '../src/codec/field-error.ts';
import {
  EXAMPLE_CATALOG,
  LoomRequestExamples,
} from '../src/codec/example-documents.ts';
import { LoomRequestSchema } from '../src/codec/request.ts';
import { YamlDocument } from '../src/codec/yaml.ts';
import { LoomRequestDispatch } from '../src/tools/dispatch.ts';
import { AgentStatsAssemblePayload } from '../src/codec/args/agent-stats.ts';
import { PrePushRequestDecoder } from '../src/codec/args/pre-push.ts';
import {
  UntrustedYamlBoundary,
  type UntrustedYamlNode,
} from '../src/lib/guards.ts';
import type { DiscoverableRequest } from '../src/tools/registry.ts';

import type { DecodeAgentStatsAssemblePayloadArgs } from '../src/codec/args/agent-stats.ts';
describe('loom domain request codec', () => {
  test('decodes a valid prePush request', () => {
    const decodedArgs6 = {
      prePush: { stageHostUpdates: true, fetchOriginMain: true },
    };
    const decoded = LoomRequestSchema.decodeLoomRequest(decodedArgs6);
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
    const decoded = LoomRequestSchema.decodeLoomRequest(decodedArgs5);
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
    const decoded = LoomRequestSchema.decodeLoomRequest(decodedArgs4);
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
    const decoded = PrePushRequestDecoder.decode(decodedArgs3);
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
    const decoded = AgentStatsAssemblePayload.decode(decodedArgs2);
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
    const decoded = AgentStatsAssemblePayload.decode(decodedArgs);
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
    const outcome = await LoomRequestDispatch.dispatchValue(outcomeArgs3);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.body.ok).toBe(true);
    if (outcome.body.ok) {
      const resultNode = UntrustedYamlBoundary.fromHost(outcome.body.result);
      if (!UntrustedYamlBoundary.isRecord(resultNode))
        throw new Error('Expected toolsList result.');
      if (!('requests' in resultNode))
        throw new Error('Expected toolsList requests.');
      const requests = resultNode.requests;
      if (!UntrustedYamlBoundary.isList(requests))
        throw new Error('Expected toolsList requests.');
      const result = requests.map(discoverableRequestView);
      expect(
        result.some((entry) => entry.family === RequestFamily.PrePush),
      ).toBe(true);
      expect(
        result.some((entry) => entry.family === RequestFamily.ToolsCall),
      ).toBe(false);
      for (const entry of result) {
        expect(entry.exampleRequest.startsWith('task loom:')).toBe(true);
        const parsed = YamlDocument.parse(entry.exampleYaml);
        expect(parsed.status).toBe(DecodeStatus.Ok);
        if (parsed.status !== DecodeStatus.Ok) {
          continue;
        }
        const decoded = LoomRequestSchema.decodeLoomRequest(parsed.value.value);
        expect(decoded.status).toBe(DecodeStatus.Ok);
        expect(entry.resolvedExampleYaml.length).toBeGreaterThan(0);
        if (entry.exampleYaml.includes('{agentTempDir}')) {
          expect(entry.resolvedExampleYaml).toContain('/nook-agent-stats/');
          expect(entry.resolvedExampleYaml).not.toContain('{agentTempDir}');
        } else {
          expect(entry.resolvedExampleYaml).toBe(entry.exampleYaml);
        }
      }
    }
  });

  test('unknown root key returns decode errors', async () => {
    const outcomeArgs2 = {
      notARequest: {},
    };
    const outcome = await LoomRequestDispatch.dispatchValue(outcomeArgs2);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe(ResponsePhase.Decode);
      expect(outcome.body.recover.toolsListRequest).toBe(
        'task loom:tools-list',
      );
    }
  });

  test('toolsCall nests into prePush decode errors', async () => {
    const outcomeArgs = {
      toolsCall: {
        prePush: { stageHostUpdates: true },
      },
    };
    const outcome = await LoomRequestDispatch.dispatchValue(outcomeArgs);
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

type DiscoverableRequestView = Pick<
  DiscoverableRequest,
  'family' | 'exampleRequest' | 'exampleYaml' | 'resolvedExampleYaml'
>;

function discoverableRequestView(
  value: UntrustedYamlNode,
): DiscoverableRequestView {
  if (!UntrustedYamlBoundary.isRecord(value))
    throw new Error('Expected toolsList request.');
  const family = Object.values(RequestFamily).find(
    (candidate) => candidate === value.family,
  );
  if (
    !family ||
    typeof value.exampleRequest !== 'string' ||
    typeof value.exampleYaml !== 'string' ||
    typeof value.resolvedExampleYaml !== 'string'
  )
    throw new Error('Expected toolsList request.');
  return {
    family,
    exampleRequest: value.exampleRequest,
    exampleYaml: value.exampleYaml,
    resolvedExampleYaml: value.resolvedExampleYaml,
  };
}

describe('typed example documents', () => {
  test('every catalog example decodes as a domain request', () => {
    for (const entry of EXAMPLE_CATALOG) {
      const decoded = LoomRequestSchema.decodeLoomRequest(
        LoomRequestExamples.exampleDocumentNode(entry.document),
      );
      expect(decoded.status).toBe(DecodeStatus.Ok);
    }
  });
});
