import { describe, expect, test } from 'bun:test';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
  type RenderDelegationVisualizationRequest,
} from '../src/domain.ts';
import { renderDelegationVisualization } from '../src/renderer.ts';

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
});
