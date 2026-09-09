import { ok } from 'neverthrow';
import { describe, expect, test } from 'bun:test';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  DelegationVisualizationTeam,
  type RenderDelegationVisualizationRequest,
} from '../src/domain.ts';
import { DelegationVisualization } from '../src/renderer.ts';
import { DelegationVisualizationApplication } from '../src/application.ts';
import { DelegationVisualizationVerifier } from '../src/result-codec.ts';

describe('delegation visualization renderer', () => {
  test('renders independent Team Agents as ordered Gizmo siblings', () => {
    const request: RenderDelegationVisualizationRequest = {
      kind: DelegationVisualizationContractKind.Request,
      tasks: [
        {
          id: 'update-cortex',
          team: DelegationVisualizationTeam.Ai,
          description: 'update Cortex',
          dependencies: [],
        },
        {
          id: 'steward-pr',
          team: DelegationVisualizationTeam.PrSteward,
          description: 'perform authorized pull-request delivery mechanics',
          dependencies: ['update-cortex'],
        },
        {
          id: 'auth-module',
          team: DelegationVisualizationTeam.DevelopmentCore,
          description: 'implement auth module',
          dependencies: ['steward-pr'],
        },
      ],
    };
    expect(
      DelegationVisualization.from(request)
        .execute()
        .gizmo.tasks.map((task) => ({
          id: task.id,
          team: task.team,
          description: task.description,
          depends_on: task.depends_on,
        })),
    ).toEqual([
      {
        id: 'update-cortex',
        team: DelegationVisualizationTeam.Ai,
        description: 'update Cortex',
        depends_on: [],
      },
      {
        id: 'steward-pr',
        team: DelegationVisualizationTeam.PrSteward,
        description: 'perform authorized pull-request delivery mechanics',
        depends_on: ['update-cortex'],
      },
      {
        id: 'auth-module',
        team: DelegationVisualizationTeam.DevelopmentCore,
        description: 'implement auth module',
        depends_on: ['steward-pr'],
      },
    ]);
  });

  test('keeps repeated teams as separate Team Agent entries', () => {
    const request: RenderDelegationVisualizationRequest = {
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
          team: DelegationVisualizationTeam.Ai,
          description: 'second task',
          dependencies: ['first'],
        },
      ],
    };
    expect(
      DelegationVisualization.from(request)
        .execute()
        .gizmo.tasks.filter(
          (task) => task.team === DelegationVisualizationTeam.Ai,
        ),
    ).toHaveLength(2);
  });

  test('preserves special characters as typed description data', () => {
    const description = 'audit: "quoted" # literal \\ path [exact]';
    const request: RenderDelegationVisualizationRequest = {
      kind: DelegationVisualizationContractKind.Request,
      tasks: [
        {
          id: 'special-description',
          team: DelegationVisualizationTeam.Security,
          description,
          dependencies: [],
        },
      ],
    };
    const rendered = DelegationVisualization.from(request).execute();
    expect(rendered.gizmo.tasks[0]?.description).toBe(description);
    expect(
      DelegationVisualizationApplication.from(request)
        .execute()
        .map((result) => result.document.gizmo.tasks[0]?.description),
    ).toEqual(ok(description));
  });

  test('constructs typed classes and verifies the admitted request', () => {
    const request: RenderDelegationVisualizationRequest = {
      kind: DelegationVisualizationContractKind.Request,
      tasks: [
        {
          id: 'first',
          team: DelegationVisualizationTeam.Ai,
          description: 'first task',
          dependencies: [],
        },
      ],
    };
    const execution =
      DelegationVisualizationApplication.from(request).execute();
    expect(execution.isOk()).toBe(true);
    if (execution.isErr()) return;
    const result = execution.value;
    expect(result.document).toBeInstanceOf(DelegationVisualizationDocument);
    expect(result.document.gizmo.tasks[0]).toBeInstanceOf(
      DelegationVisualizationDocumentTask,
    );
    expect(
      DelegationVisualizationVerifier.from({
        request,
        result,
      }).execute(),
    ).toEqual(ok(result));
    const extraResult = { ...result };
    Object.assign(extraResult, { unverified: true });
    expect(
      DelegationVisualizationVerifier.from({
        request,
        result: extraResult,
      })
        .execute()
        .isErr(),
    ).toBe(true);
  });

  test('rejects every tampered typed field and ordering invariant', () => {
    const request: RenderDelegationVisualizationRequest = {
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
          dependencies: [],
        },
        {
          id: 'third',
          team: DelegationVisualizationTeam.WebDevelopment,
          description: 'third task',
          dependencies: ['first', 'second'],
        },
      ],
    };
    const execution =
      DelegationVisualizationApplication.from(request).execute();
    expect(execution.isOk()).toBe(true);
    if (execution.isErr()) return;
    const result = execution.value;
    const [first, second, third] = result.document.gizmo.tasks;
    expect(first && second && third).toBeDefined();
    if (!first || !second || !third) return;
    const tamperedDocuments = [
      new DelegationVisualizationDocument([
        new DelegationVisualizationDocumentTask({
          id: 'changed-id',
          team: first.team,
          description: first.description,
          dependsOn: first.depends_on,
        }),
        second,
        third,
      ]),
      new DelegationVisualizationDocument([
        new DelegationVisualizationDocumentTask({
          id: first.id,
          team: DelegationVisualizationTeam.Sre,
          description: first.description,
          dependsOn: first.depends_on,
        }),
        second,
        third,
      ]),
      new DelegationVisualizationDocument([
        new DelegationVisualizationDocumentTask({
          id: first.id,
          team: first.team,
          description: 'changed description',
          dependsOn: first.depends_on,
        }),
        second,
        third,
      ]),
      new DelegationVisualizationDocument([second, first, third]),
      new DelegationVisualizationDocument([
        first,
        second,
        new DelegationVisualizationDocumentTask({
          id: third.id,
          team: third.team,
          description: third.description,
          dependsOn: ['second', 'first'],
        }),
      ]),
    ];
    for (const document of tamperedDocuments) {
      expect(
        DelegationVisualizationVerifier.from({
          request,
          result: { ...result, document },
        })
          .execute()
          .isErr(),
      ).toBe(true);
    }
  });
});
