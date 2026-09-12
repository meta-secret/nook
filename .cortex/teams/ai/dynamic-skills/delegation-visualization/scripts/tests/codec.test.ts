import { ok } from 'neverthrow';
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

  task(index: number) {
    const task = this.value.tasks.at(index);
    if (!task) throw new Error(`Missing task fixture at ${index}`);
    return task;
  }
}

describe('delegation visualization codec', () => {
  test('decodes the exact ordered plan', () => {
    expect(
      DelegationVisualizationRequestDecoder.from(
        JSON.stringify(new DelegationVisualizationRequestFixture().value),
      )
        .execute()
        .map((request) => request.tasks.length),
    ).toEqual(ok(2));
  });

  test('rejects duplicate, missing, forward, and self dependencies', () => {
    const duplicateIdFixture = new DelegationVisualizationRequestFixture();
    duplicateIdFixture.task(1).id = 'first';
    const duplicateId = duplicateIdFixture.value;
    expect(
      DelegationVisualizationRequestDecoder.from(JSON.stringify(duplicateId))
        .execute()
        .isErr(),
    ).toBe(true);

    for (const dependency of ['missing', 'second']) {
      const invalidFixture = new DelegationVisualizationRequestFixture();
      invalidFixture.task(0).dependencies = [dependency];
      const invalid = invalidFixture.value;
      expect(
        DelegationVisualizationRequestDecoder.from(JSON.stringify(invalid))
          .execute()
          .isErr(),
      ).toBe(true);
    }
  });

  test('rejects unknown teams, duplicate edges, and unknown fields', () => {
    const unknownTeamFixture = new DelegationVisualizationRequestFixture();
    Object.assign(unknownTeamFixture.task(0), { team: 'product' });
    const unknownTeam = unknownTeamFixture.value;
    expect(
      DelegationVisualizationRequestDecoder.from(JSON.stringify(unknownTeam))
        .execute()
        .isErr(),
    ).toBe(true);

    const duplicateEdgeFixture = new DelegationVisualizationRequestFixture();
    duplicateEdgeFixture.task(1).dependencies = ['first', 'first'];
    const duplicateEdge = duplicateEdgeFixture.value;
    expect(
      DelegationVisualizationRequestDecoder.from(JSON.stringify(duplicateEdge))
        .execute()
        .isErr(),
    ).toBe(true);

    const extraFixture = new DelegationVisualizationRequestFixture();
    Object.assign(extraFixture.task(0), { admission: true });
    const extra = extraFixture.value;
    expect(
      DelegationVisualizationRequestDecoder.from(JSON.stringify(extra))
        .execute()
        .isErr(),
    ).toBe(true);
  });

  test('rejects YAML-non-printable C1 description characters', () => {
    for (const character of ['\u0080', '\u0086', '\u009f']) {
      const invalidFixture = new DelegationVisualizationRequestFixture();
      invalidFixture.task(0).description = `blocked${character}`;
      const invalid = invalidFixture.value;
      expect(
        DelegationVisualizationRequestDecoder.from(JSON.stringify(invalid))
          .execute()
          .isErr(),
      ).toBe(true);
    }
  });
});
