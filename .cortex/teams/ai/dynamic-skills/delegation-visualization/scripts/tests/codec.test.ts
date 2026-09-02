import { describe, expect, test } from 'bun:test';
import { decodeDelegationVisualizationRequest } from '../src/codec.ts';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
} from '../src/domain.ts';

function request() {
  return {
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
        team: DelegationVisualizationTeam.Security,
        description: 'second task',
        dependencies: ['first'],
      },
    ],
  };
}

describe('delegation visualization codec', () => {
  test('decodes the exact ordered plan', () => {
    expect(
      decodeDelegationVisualizationRequest(JSON.stringify(request())).tasks,
    ).toHaveLength(2);
  });

  test('rejects duplicate, missing, forward, and self dependencies', () => {
    const duplicateId = request();
    duplicateId.tasks[1]!.id = 'first';
    expect(() =>
      decodeDelegationVisualizationRequest(JSON.stringify(duplicateId)),
    ).toThrow();

    for (const dependency of ['missing', 'second']) {
      const invalid = request();
      invalid.tasks[0]!.dependencies = [dependency];
      expect(() =>
        decodeDelegationVisualizationRequest(JSON.stringify(invalid)),
      ).toThrow();
    }
  });

  test('rejects unknown teams, duplicate edges, and unknown fields', () => {
    const unknownTeam = request();
    Object.assign(unknownTeam.tasks[0]!, { team: 'product' });
    expect(() =>
      decodeDelegationVisualizationRequest(JSON.stringify(unknownTeam)),
    ).toThrow();

    const duplicateEdge = request();
    duplicateEdge.tasks[1]!.dependencies = ['first', 'first'];
    expect(() =>
      decodeDelegationVisualizationRequest(JSON.stringify(duplicateEdge)),
    ).toThrow();

    const extra = request();
    Object.assign(extra.tasks[0]!, { admission: true });
    expect(() =>
      decodeDelegationVisualizationRequest(JSON.stringify(extra)),
    ).toThrow();
  });
});
