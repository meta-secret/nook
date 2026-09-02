import { describe, expect, test } from 'bun:test';
import { RequestFamily, ResponsePhase } from '../src/codec/enums.ts';
import { DecodeStatus } from '../src/codec/field-error.ts';
import {
  EXAMPLE_CATALOG,
  exampleDocumentNode,
} from '../src/codec/example-documents.ts';
import { decodeLoomRequest } from '../src/codec/request.ts';
import { parseYamlText } from '../src/codec/yaml.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';
import { decodePrePushRequest } from '../src/codec/args/pre-push.ts';

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

  test('rejects generic local agentStats execution', async () => {
    const decodedArgs5 = {
      agentStats: {
        assemble: {
          prNumber: 12,
          scratchPath: '/tmp/a.json',
          outputPath: '/tmp/12.yaml',
          includeTestInventory: true,
        },
      },
    };
    const outcome = await dispatchValue(decodedArgs5);
    expect(outcome.exitCode).toBe(1);
    expect(JSON.stringify(outcome.body)).toContain(
      'task loom:agent-stats-control',
    );
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
          resolvedExampleYaml: string;
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
        expect(entry.exampleRequest.startsWith('task loom:')).toBe(true);
        const parsed = parseYamlText(entry.exampleYaml);
        expect(parsed.status).toBe(DecodeStatus.Ok);
        if (parsed.status !== DecodeStatus.Ok) {
          continue;
        }
        const decoded = decodeLoomRequest(parsed.value.value);
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
    const outcome = await dispatchValue(outcomeArgs2);
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

describe('typed example documents', () => {
  test('every catalog example decodes as a domain request', () => {
    for (const entry of EXAMPLE_CATALOG) {
      const decoded = decodeLoomRequest(exampleDocumentNode(entry.document));
      expect(decoded.status).toBe(DecodeStatus.Ok);
    }
  });
});
