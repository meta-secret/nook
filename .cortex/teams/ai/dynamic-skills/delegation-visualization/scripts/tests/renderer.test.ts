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
import { renderDelegationVisualizationJson } from '../src/cli.ts';

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
        'gizmo',
        '├─ ai',
        '│ └─ update Cortex',
        '├─ web-development',
        '│ └─ create security key component [after: update-cortex]',
        '└─ development-core',
        '  └─ implement auth module [after: security-key]',
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
    expect(renderDelegationVisualization(request).match(/ai/gu)).toHaveLength(
      2,
    );
  });

  test('round-trips and verifies the admitted request against the tree', () => {
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
        result: { ...result, tree: 'gizmo\n' },
      }),
    ).toThrow();
    expect(() =>
      decodeDelegationVisualizationResult(
        JSON.stringify({ ...result, unverified: true }),
      ),
    ).toThrow();
  });

  test('renders a strict JSON request without the executable-skill host', () => {
    expect(
      renderDelegationVisualizationJson(
        JSON.stringify({
          kind: DelegationVisualizationContractKind.Request,
          tasks: [
            {
              id: 'first',
              team: DelegationVisualizationTeam.Ai,
              description: 'first task',
              dependencies: [],
            },
          ],
        }),
      ),
    ).toBe('gizmo\n└─ ai\n  └─ first task\n');
  });
});
