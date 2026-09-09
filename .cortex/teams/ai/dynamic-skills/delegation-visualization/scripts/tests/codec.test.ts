import { describe, expect, test } from 'bun:test';
import { DelegationVisualizationRequestDecoder } from '../src/codec.ts';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
} from '../src/domain.ts';

class DelegationVisualizationRequestFixture {
  readonly value = {
    kind: DelegationVisualizationContractKind.Request,
    tasks: [
      {
        id: 'first',
        team: DelegationVisualizationTeam.Ai,
        description: 'first task',
        dependencies: [],
      },
      {
        id: 'second',
        team: DelegationVisualizationTeam.PrSteward,
        description: 'second task',
        dependencies: ['first'],
      },
    ],
  };
}

describe('delegation visualization codec', () => {
  test('decodes the exact ordered plan', () => {
    expect(
      DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
        JSON.stringify(new DelegationVisualizationRequestFixture().value),
      ).tasks,
    ).toHaveLength(2);
  });

  test('rejects duplicate, missing, forward, and self dependencies', () => {
    const duplicateId = new DelegationVisualizationRequestFixture().value;
    duplicateId.tasks[1]!.id = 'first';
    expect(() =>
      DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
        JSON.stringify(duplicateId),
      ),
    ).toThrow();

    for (const dependency of ['missing', 'second']) {
      const invalid = new DelegationVisualizationRequestFixture().value;
      invalid.tasks[0]!.dependencies = [dependency];
      expect(() =>
        DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
          JSON.stringify(invalid),
        ),
      ).toThrow();
    }
  });

  test('rejects unknown teams, duplicate edges, and unknown fields', () => {
    const unknownTeam = new DelegationVisualizationRequestFixture().value;
    Object.assign(unknownTeam.tasks[0]!, { team: 'product' });
    expect(() =>
      DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
        JSON.stringify(unknownTeam),
      ),
    ).toThrow();

    const duplicateEdge = new DelegationVisualizationRequestFixture().value;
    duplicateEdge.tasks[1]!.dependencies = ['first', 'first'];
    expect(() =>
      DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
        JSON.stringify(duplicateEdge),
      ),
    ).toThrow();

    const extra = new DelegationVisualizationRequestFixture().value;
    Object.assign(extra.tasks[0]!, { admission: true });
    expect(() =>
      DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
        JSON.stringify(extra),
      ),
    ).toThrow();
  });

  test('rejects YAML-non-printable C1 description characters', () => {
    for (const character of ['\u0080', '\u0086', '\u009f']) {
      const invalid = new DelegationVisualizationRequestFixture().value;
      invalid.tasks[0]!.description = `blocked${character}`;
      expect(() =>
        DelegationVisualizationRequestDecoder.decodeDelegationVisualizationRequest(
          JSON.stringify(invalid),
        ),
      ).toThrow();
    }
  });
});
