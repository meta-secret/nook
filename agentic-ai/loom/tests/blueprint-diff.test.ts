import { describe, expect, test } from 'bun:test';
import {
  BlueprintChangeKind,
  YamlValueKind,
  explainAgainstBlueprint,
  explainSyntaxFailure,
} from '../src/codec/blueprint-diff.ts';
import { encodeResponse } from '../src/codec/response.ts';
import { ResponsePhase } from '../src/codec/enums.ts';
import { FieldIssue, fieldError } from '../src/codec/field-error.ts';
import { decodeErrorResponse } from '../src/codec/response.ts';
import { dispatchValue } from '../src/tools/dispatch.ts';

describe('blueprint explanation', () => {
  test('marks missing prePush fields against the blueprint', () => {
    const explanation = explainAgainstBlueprint({
      prePush: { stageHostUpdates: true },
    });
    expect(explanation.blueprintPath).toContain('pre-push/default.yaml');
    expect(explanation.blueprintYaml).toContain('fetchOriginMain');
    expect(explanation.receivedYaml).toContain('stageHostUpdates');
    expect(
      explanation.changes.some(
        (change) =>
          change.kind === BlueprintChangeKind.Missing &&
          change.path === 'prePush.fetchOriginMain' &&
          change.expectedKind === YamlValueKind.Boolean,
      ),
    ).toBe(true);
  });

  test('marks extra root keys against the closest blueprint', () => {
    const explanation = explainAgainstBlueprint({
      name: 'agent-stats',
      arguments: { action: 'assemble' },
    });
    expect(
      explanation.changes.some(
        (change) =>
          change.kind === BlueprintChangeKind.Extra && change.path === 'name',
      ),
    ).toBe(true);
  });

  test('syntax failures include parse message and a blueprint template', () => {
    const explanation = explainSyntaxFailure(
      'prePush: [\n',
      'unexpected end of stream',
    );
    expect(explanation.changes).toHaveLength(1);
    for (const change of explanation.changes) {
      expect(change.kind).toBe(BlueprintChangeKind.SyntaxInvalid);
      if (change.kind === BlueprintChangeKind.SyntaxInvalid) {
        expect(change.parseMessage).toBe('unexpected end of stream');
      }
    }
    expect(explanation.blueprintYaml).toContain('prePush:');
  });
});

describe('decode error encoding', () => {
  test('dispatch decode errors expose explanation with blueprint and changes', async () => {
    const outcome = await dispatchValue({
      prePush: { stageHostUpdates: true },
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.body.ok).toBe(false);
    if (outcome.body.ok) {
      return;
    }
    expect('explanation' in outcome.body).toBe(true);
    if (!('explanation' in outcome.body)) {
      return;
    }
    expect(outcome.body.explanation.blueprintPath).toContain('pre-push');
    expect(
      outcome.body.explanation.changes.some(
        (change) =>
          change.kind !== BlueprintChangeKind.SyntaxInvalid &&
          change.path === 'prePush.fetchOriginMain',
      ),
    ).toBe(true);

    const encoded = encodeResponse(outcome.body) as {
      explanation: {
        blueprintYaml: string;
        receivedYaml: string;
        changes: readonly { kind: string; path: string }[];
      };
    };
    expect(encoded.explanation.blueprintYaml).toContain('fetchOriginMain');
    expect(encoded.explanation.receivedYaml).toContain('stageHostUpdates');
  });

  test('encodeResponse includes issue codes and explanation', () => {
    const explanation = explainAgainstBlueprint({
      prePush: { stageHostUpdates: true },
    });
    const encoded = encodeResponse(
      decodeErrorResponse(
        ResponsePhase.Decode,
        [
          fieldError(
            'prePush.fetchOriginMain',
            FieldIssue.MissingRequiredField,
          ),
        ],
        explanation,
      ),
    ) as {
      errors: readonly { issue: FieldIssue; message: string }[];
      explanation: { changes: readonly unknown[] };
    };
    for (const error of encoded.errors) {
      expect(error.issue).toBe(FieldIssue.MissingRequiredField);
      expect(error.message).toBe('missing required field');
    }
    expect(encoded.explanation.changes.length).toBeGreaterThan(0);
  });
});
