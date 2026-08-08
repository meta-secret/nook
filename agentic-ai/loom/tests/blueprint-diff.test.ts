import { describe, expect, test } from 'bun:test';
import {
  BlueprintExplanationKind,
  explainAgainstBlueprint,
  explainSyntaxFailure,
} from '../src/codec/blueprint-diff.ts';
import { ResponsePhase } from '../src/codec/enums.ts';
import { FieldIssue, fieldError } from '../src/codec/field-error.ts';
import { decodeErrorResponse, encodeResponse } from '../src/codec/response.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';

import type { FieldErrorArgs } from '../src/codec/field-error.ts';
import type { DecodeErrorResponseArgs } from '../src/codec/response.ts';
import type { ExplainSyntaxFailureArgs } from '../src/codec/blueprint-diff.ts';
describe('blueprint explanation', () => {
  test('emits a unified diff from the diff package', () => {
    const explanationArgs4 = {
      prePush: { stageHostUpdates: true },
    };
    const explanation = explainAgainstBlueprint(explanationArgs4);
    expect(explanation.kind).toBe(BlueprintExplanationKind.Structural);
    expect(explanation.blueprintPath).toContain('pre-push/default.yaml');
    expect(explanation.unifiedDiff).toContain('--- ');
    expect(explanation.unifiedDiff).toContain('+++ received.yaml');
    expect(explanation.unifiedDiff).toContain('fetchOriginMain');
  });

  test('marks unknown roots against the default blueprint', () => {
    const explanationArgs3 = {
      name: 'agent-stats',
      arguments: { action: 'assemble' },
    };
    const explanation = explainAgainstBlueprint(explanationArgs3);
    expect(explanation.unifiedDiff).toContain('name');
    expect(explanation.blueprintYaml).toContain('prePush:');
  });

  test('syntax failures include parse message and unified diff', () => {
    const explanationArgs2: ExplainSyntaxFailureArgs = {
      receivedYaml: 'prePush: [\n',
      parseMessage: 'unexpected end of stream',
    };
    const explanation = explainSyntaxFailure(explanationArgs2);
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
    const outcome = await dispatchValue(outcomeArgs);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (outcome.body.ok || !('explanation' in outcome.body)) {
      return;
    }
    expect(outcome.body.explanation.unifiedDiff).toContain('fetchOriginMain');
    const encoded = encodeResponse(outcome.body) as {
      explanation: { unifiedDiff: string; kind: string };
    };
    expect(encoded.explanation.unifiedDiff).toContain('+++ received.yaml');
    expect(encoded.explanation.kind).toBe(BlueprintExplanationKind.Structural);
  });

  test('encodeResponse includes issue codes and explanation', () => {
    const explanationArgs = {
      prePush: { stageHostUpdates: true },
    };
    const explanation = explainAgainstBlueprint(explanationArgs);
    const fieldErrorArgs: FieldErrorArgs = {
      path: 'prePush.fetchOriginMain',
      issue: FieldIssue.MissingRequiredField,
    };
    const decodeErrorResponseArgs: DecodeErrorResponseArgs = {
      phase: ResponsePhase.Decode,
      errors: [fieldError(fieldErrorArgs)],
      explanation,
    };
    const encoded = encodeResponse(
      decodeErrorResponse(decodeErrorResponseArgs),
    ) as {
      errors: readonly { issue: FieldIssue; message: string }[];
      explanation: { unifiedDiff: string };
    };
    for (const error of encoded.errors) {
      expect(error.issue).toBe(FieldIssue.MissingRequiredField);
      expect(error.message).toBe('missing required field');
    }
    expect(encoded.explanation.unifiedDiff.length).toBeGreaterThan(0);
  });
});
