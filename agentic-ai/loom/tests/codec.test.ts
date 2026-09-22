import { describe, expect, test } from 'bun:test';
import { RequestFamily, ResponsePhase } from '../src/codec/enums.ts';
import { DecodeStatus, FieldDetailKind } from '../src/codec/field-error.ts';
import {
  EXAMPLE_CATALOG,
  LoomRequestExamples,
} from '../src/codec/example-documents.ts';
import { LoomRequestSchema } from '../src/codec/request.ts';
import { YamlDocument } from '../src/codec/yaml.ts';
import { LoomRequestDispatch } from '../src/tools/dispatch.ts';
import { PrePushRequestDecoder } from '../src/codec/args/pre-push.ts';
import {
  UntrustedYamlBoundary,
  type UntrustedYamlNode,
} from '../src/lib/guards.ts';
import type { DiscoverableRequest } from '../src/tools/registry.ts';

class DiscoverableRequestHostInput {
  constructor(private readonly value: UntrustedYamlNode) {}

  toView(): DiscoverableRequestView {
    const value = this.value;
    if (!UntrustedYamlBoundary.isRecord(value))
      throw new Error('Expected toolsList request.');
    const family = Object.values(RequestFamily).find(
      (candidate) => candidate === value.family,
    );
    if (
      !family ||
      typeof value.exampleRequest !== 'string' ||
      typeof value.exampleYaml !== 'string'
    )
      throw new Error('Expected toolsList request.');
    return {
      family,
      exampleRequest: value.exampleRequest,
      exampleYaml: value.exampleYaml,
    };
  }
}

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

  test('rejects generic arguments envelopes', () => {
    const decodedArgs4 = {
      name: 'unsupported-command',
      arguments: { action: 'run' },
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
      const result = requests.map((value) =>
        new DiscoverableRequestHostInput(value).toView(),
      );
      expect(
        result.some((entry) => entry.family === RequestFamily.PrePush),
      ).toBe(false);
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

  test('retired prePush requests fail without executing a host command', async () => {
    const outcome = await LoomRequestDispatch.dispatchValue({
      prePush: { stageHostUpdates: true, fetchOriginMain: true },
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.body.ok).toBe(false);
    if (!outcome.body.ok) {
      expect(outcome.body.phase).toBe(ResponsePhase.Execute);
      expect(outcome.body.errors[0]?.detail).toMatchObject({
        kind: 'text',
      });
      const detail = outcome.body.errors[0]?.detail;
      if (detail?.kind === FieldDetailKind.Text) {
        expect(detail.text).toContain('feature PR lifecycle validation checks');
        expect(detail.text).not.toContain('manager-owned CI validation cycle');
      }
    }
  });
});

type DiscoverableRequestView = Pick<
  DiscoverableRequest,
  'family' | 'exampleRequest' | 'exampleYaml'
>;

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
