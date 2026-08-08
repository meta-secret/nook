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

describe('blueprint explanation', () => {
  test('emits a unified diff from the diff package', () => {
    const explanation = explainAgainstBlueprint({
      prePush: { stageHostUpdates: true },
    });
    expect(explanation.kind).toBe(BlueprintExplanationKind.Structural);
    expect(explanation.blueprintPath).toContain('pre-push/default.yaml');
    expect(explanation.unifiedDiff).toContain('--- ');
    expect(explanation.unifiedDiff).toContain('+++ received.yaml');
    expect(explanation.unifiedDiff).toContain('fetchOriginMain');
  });

  test('marks unknown roots against the default blueprint', () => {
    const explanation = explainAgainstBlueprint({
      name: 'agent-stats',
      arguments: { action: 'assemble' },
    });
    expect(explanation.unifiedDiff).toContain('name');
    expect(explanation.blueprintYaml).toContain('prePush:');
  });

  test('syntax failures include parse message and unified diff', () => {
    const explanation = explainSyntaxFailure({
      receivedYaml: 'prePush: [\n',
      parseMessage: 'unexpected end of stream',
    });
    expect(explanation.kind).toBe(BlueprintExplanationKind.Syntax);
    if (explanation.kind === BlueprintExplanationKind.Syntax) {
      expect(explanation.parseMessage).toBe('unexpected end of stream');
    }
    expect(explanation.unifiedDiff).toContain('received.yaml');
  });
});

describe('decode error encoding', () => {
  test('dispatch decode errors expose unifiedDiff', async () => {
    const outcome = await dispatchValue({
      prePush: { stageHostUpdates: true },
    });
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
    const explanation = explainAgainstBlueprint({
      prePush: { stageHostUpdates: true },
    });
    const encoded = encodeResponse(
      decodeErrorResponse({
        phase: ResponsePhase.Decode,
        errors: [
          fieldError({
            path: 'prePush.fetchOriginMain',
            issue: FieldIssue.MissingRequiredField,
          }),
        ],
        explanation,
      }),
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
