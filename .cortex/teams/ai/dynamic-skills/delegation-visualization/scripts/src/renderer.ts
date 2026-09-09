import {
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

export class DelegationVisualization {
  private constructor(
    private readonly request: RenderDelegationVisualizationRequest,
  ) {}

  static renderDelegationVisualization(
    request: RenderDelegationVisualizationRequest,
  ): DelegationVisualizationDocument {
    return new DelegationVisualization(request).execute();
  }

  private execute(): DelegationVisualizationDocument {
    const request = this.request;
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
}
