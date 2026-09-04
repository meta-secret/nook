import {
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

export function renderDelegationVisualization(
  request: RenderDelegationVisualizationRequest,
): DelegationVisualizationDocument {
  const tasks = request.tasks.map(
    (task) =>
      new DelegationVisualizationDocumentTask({
        id: task.id,
        team: task.team,
        description: task.description,
        dependsOn: task.dependencies,
      }),
  );
  return new DelegationVisualizationDocument(tasks);
}
