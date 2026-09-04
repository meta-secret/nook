import { describe, expect, test } from 'bun:test';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  DelegationVisualizationTeam,
  type RenderDelegationVisualizationRequest,
} from '../src/domain.ts';
import { renderDelegationVisualization } from '../src/renderer.ts';
import { executeDelegationVisualizationApplication } from '../src/application.ts';
import { verifyDelegationVisualizationResult } from '../src/result-codec.ts';

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
          id: 'security-key',
          team: DelegationVisualizationTeam.WebDevelopment,
          description: 'create security key component',
          dependencies: ['update-cortex'],
        },
        {
          id: 'auth-module',
          team: DelegationVisualizationTeam.DevelopmentCore,
          description: 'implement auth module',
          dependencies: ['security-key'],
        },
      ],
    };
    expect(renderDelegationVisualization(request)).toEqual({
      gizmo: {
        tasks: [
          {
            id: 'update-cortex',
            team: DelegationVisualizationTeam.Ai,
            description: 'update Cortex',
            depends_on: [],
          },
          {
            id: 'security-key',
            team: DelegationVisualizationTeam.WebDevelopment,
            description: 'create security key component',
            depends_on: ['update-cortex'],
          },
          {
            id: 'auth-module',
            team: DelegationVisualizationTeam.DevelopmentCore,
            description: 'implement auth module',
            depends_on: ['security-key'],
          },
        ],
      },
    });
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
      renderDelegationVisualization(request).gizmo.tasks.filter(
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
    const rendered = renderDelegationVisualization(request);
    expect(rendered.gizmo.tasks[0]?.description).toBe(description);
    expect(
      executeDelegationVisualizationApplication(request).document.gizmo.tasks[0]
        ?.description,
    ).toBe(description);
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
    const result = executeDelegationVisualizationApplication(request);
    expect(result.document).toBeInstanceOf(DelegationVisualizationDocument);
    expect(result.document.gizmo.tasks[0]).toBeInstanceOf(
      DelegationVisualizationDocumentTask,
    );
    expect(
      verifyDelegationVisualizationResult({
        request,
        result,
      }),
    ).toEqual(result);
    const extraResult = { ...result };
    Object.assign(extraResult, { unverified: true });
    expect(() =>
      verifyDelegationVisualizationResult({ request, result: extraResult }),
    ).toThrow();
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
          team: DelegationVisualizationTeam.Security,
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
    const result = executeDelegationVisualizationApplication(request);
    const [first, second, third] = result.document.gizmo.tasks;
    if (!first || !second || !third) throw new Error('Missing test task.');
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
      expect(() =>
        verifyDelegationVisualizationResult({
          request,
          result: { ...result, document },
        }),
      ).toThrow();
    }
  });
});
