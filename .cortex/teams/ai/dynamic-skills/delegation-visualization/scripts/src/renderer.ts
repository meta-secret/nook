import { stringify as stringifyYaml } from 'yaml';
import type { RenderDelegationVisualizationRequest } from './domain.ts';

export function renderDelegationVisualization(
  request: RenderDelegationVisualizationRequest,
): string {
  const document = {
    gizmo: {
      tasks: request.tasks.map((task) => ({
        id: task.id,
        team: task.team,
        description: task.description,
        depends_on: task.dependencies,
      })),
    },
  };
  return stringifyYaml(document);
}
