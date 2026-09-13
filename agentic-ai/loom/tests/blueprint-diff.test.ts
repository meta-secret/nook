import { describe, expect, test } from 'bun:test';
import {
  BlueprintExplanationKind,
  RequestBlueprintComparison,
} from '../src/codec/blueprint-diff.ts';
import { ResponsePhase } from '../src/codec/enums.ts';
import { FieldIssue, FieldDiagnostic } from '../src/codec/field-error.ts';
import { LoomResponseEncoder } from '../src/codec/response.ts';
import { LoomRequestDispatch } from '../src/tools/dispatch.ts';

import type { FieldErrorArgs } from '../src/codec/field-error.ts';
import type { DecodeErrorResponseArgs } from '../src/codec/response.ts';
import type { ExplainSyntaxFailureArgs } from '../src/codec/blueprint-diff.ts';
import { UntrustedYamlBoundary } from '../src/lib/guards.ts';
describe('blueprint explanation', () => {
  test('emits a unified diff from the diff package', () => {
    const explanationArgs4 = {
      prePush: { stageHostUpdates: true },
    };
    const explanation =
      RequestBlueprintComparison.explainAgainstBlueprint(explanationArgs4);
    expect(explanation.kind).toBe(BlueprintExplanationKind.Structural);
    expect(explanation.blueprintPath).toBe('prePush');
    expect(explanation.unifiedDiff).toContain('--- ');
    expect(explanation.unifiedDiff).toContain('+++ received.yaml');
    expect(explanation.unifiedDiff).toContain('fetchOriginMain');
  });

  test('marks unknown roots against the default blueprint', () => {
    const explanationArgs3 = {
      name: 'agent-stats',
      arguments: { action: 'assemble' },
    };
    const explanation =
      RequestBlueprintComparison.explainAgainstBlueprint(explanationArgs3);
    expect(explanation.unifiedDiff).toContain('name');
    expect(explanation.blueprintYaml).toContain('prePush:');
  });

  test('syntax failures include parse message and unified diff', () => {
    const explanationArgs2: ExplainSyntaxFailureArgs = {
      receivedYaml: 'prePush: [\n',
      parseMessage: 'unexpected end of stream',
    };
    const explanation =
      RequestBlueprintComparison.explainSyntaxFailure(explanationArgs2);
    expect(explanation.kind).toBe(BlueprintExplanationKind.Syntax);
    if (explanation.kind === BlueprintExplanationKind.Syntax) {
      expect(explanation.parseMessage).toBe('unexpected end of stream');
    }
    expect(explanation.unifiedDiff).toContain('received.yaml');
  });
});

describe('decode error encoding', () => {
  test('dispatch decode errors expose unifiedDiff', async () => {
    const outcomeArgs = {
      prePush: { stageHostUpdates: true },
    };
    const outcome = await LoomRequestDispatch.dispatchValue(outcomeArgs);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (outcome.body.ok || !('explanation' in outcome.body)) {
      return;
    }
    if (typeof outcome.body.explanation.unifiedDiff !== 'string') return;
    expect(outcome.body.explanation.unifiedDiff).toContain('fetchOriginMain');
    const encoded = LoomResponseEncoder.encodeResponse(outcome.body);
    if (!UntrustedYamlBoundary.isRecord(encoded))
      throw new Error('Invalid response.');
    if (!('explanation' in encoded)) throw new Error('Invalid explanation.');
    const explanation = encoded.explanation;
    if (!UntrustedYamlBoundary.isRecord(explanation))
      throw new Error('Invalid explanation.');
    if (!('unifiedDiff' in explanation))
      throw new Error('Missing unified diff.');
    if (typeof explanation.unifiedDiff !== 'string')
      throw new Error('Missing unified diff.');
    expect(explanation.unifiedDiff).toContain('+++ received.yaml');
    expect(explanation.kind).toBe(BlueprintExplanationKind.Structural);
  });

  test('encodeResponse includes issue codes and explanation', () => {
    const explanationArgs = {
      prePush: { stageHostUpdates: true },
    };
    const explanation =
      RequestBlueprintComparison.explainAgainstBlueprint(explanationArgs);
    const fieldErrorArgs: FieldErrorArgs = {
      path: 'prePush.fetchOriginMain',
      issue: FieldIssue.MissingRequiredField,
    };
    const decodeErrorResponseArgs: DecodeErrorResponseArgs = {
      phase: ResponsePhase.Decode,
      errors: [FieldDiagnostic.create(fieldErrorArgs)],
      explanation,
    };
    const encoded = LoomResponseEncoder.encodeResponse(
      LoomResponseEncoder.decodeErrorResponse(decodeErrorResponseArgs),
    );
    if (!UntrustedYamlBoundary.isRecord(encoded))
      throw new Error('Invalid response.');
    const errors = encoded.errors;
    if (!errors || !UntrustedYamlBoundary.isList(errors))
      throw new Error('Invalid errors.');
    for (const error of errors) {
      if (!UntrustedYamlBoundary.isRecord(error))
        throw new Error('Invalid error.');
      expect(error.issue).toBe(FieldIssue.MissingRequiredField);
      expect(error.message).toBe('missing required field');
    }
    if (!('explanation' in encoded)) throw new Error('Invalid explanation.');
    const encodedExplanation = encoded.explanation;
    if (!UntrustedYamlBoundary.isRecord(encodedExplanation))
      throw new Error('Invalid explanation.');
    if (!('unifiedDiff' in encodedExplanation))
      throw new Error('Missing unified diff.');
    if (typeof encodedExplanation.unifiedDiff !== 'string')
      throw new Error('Missing unified diff.');
    expect(encodedExplanation.unifiedDiff.length).toBeGreaterThan(0);
  });
});
