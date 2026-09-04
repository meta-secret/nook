import type { RenderDelegationVisualizationRequest } from './domain.ts';

export function renderDelegationVisualization(
  request: RenderDelegationVisualizationRequest,
): string {
  const lines = ['gizmo:', '  tasks:'];
  for (const task of request.tasks) {
    lines.push(`    - id: ${quoteYamlScalar(task.id)}`);
    lines.push(`      team: ${quoteYamlScalar(task.team)}`);
    lines.push(`      description: ${quoteYamlScalar(task.description)}`);
    if (task.dependencies.length === 0) {
      lines.push('      depends_on: []');
      continue;
    }
    lines.push('      depends_on:');
    for (const dependency of task.dependencies) {
      lines.push(`        - ${quoteYamlScalar(dependency)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function quoteYamlScalar(value: string): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new Error('Delegation visualization YAML scalar is invalid.');
  }
  return serialized;
}
