import type {
  DelegationVisualizationTask,
  RenderDelegationVisualizationRequest,
} from './domain.ts';

const TREE_ROOT = 'gizmo';

export function renderDelegationVisualization(
  request: RenderDelegationVisualizationRequest,
): string {
  const lines = [TREE_ROOT];
  const lastTask = request.tasks.at(-1);
  for (const task of request.tasks) {
    lines.push(`${task === lastTask ? '└─' : '├─'} ${task.team}`);
    const continuation = task === lastTask ? '  ' : '│ ';
    lines.push(`${continuation}└─ ${renderTask(task)}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderTask(task: DelegationVisualizationTask): string {
  if (task.dependencies.length === 0) return task.description;
  return `${task.description} [after: ${task.dependencies.join(', ')}]`;
}
