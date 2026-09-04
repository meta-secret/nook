import { describe, expect, test } from 'bun:test';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
  type RenderDelegationVisualizationRequest,
} from '../src/domain.ts';
import { renderDelegationVisualization } from '../src/renderer.ts';
import { executeDelegationVisualizationApplication } from '../src/application.ts';
import {
  decodeDelegationVisualizationResult,
  verifyDelegationVisualizationResult,
} from '../src/result-codec.ts';

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
    expect(renderDelegationVisualization(request)).toBe(
      [
        'gizmo:',
        '  tasks:',
        '    - id: update-cortex',
        '      team: ai',
        '      description: update Cortex',
        '      depends_on: []',
        '    - id: security-key',
        '      team: web-development',
        '      description: create security key component',
        '      depends_on:',
        '        - update-cortex',
        '    - id: auth-module',
        '      team: development-core',
        '      description: implement auth module',
        '      depends_on:',
        '        - security-key',
        '',
      ].join('\n'),
    );
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
      renderDelegationVisualization(request).match(/team: ai/gu),
    ).toHaveLength(2);
  });

  test('round-trips and verifies the admitted request against the YAML', () => {
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
    expect(
      verifyDelegationVisualizationResult({
        request,
        result: decodeDelegationVisualizationResult(JSON.stringify(result)),
      }),
    ).toEqual(result);
    expect(() =>
      verifyDelegationVisualizationResult({
        request,
        result: { ...result, yaml: 'gizmo:\n' },
      }),
    ).toThrow();
    expect(() =>
      decodeDelegationVisualizationResult(
        JSON.stringify({ ...result, unverified: true }),
      ),
    ).toThrow();
  });
});
