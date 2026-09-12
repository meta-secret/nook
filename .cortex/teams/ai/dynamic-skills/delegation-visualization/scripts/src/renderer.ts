import {
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

export class DelegationVisualization {
  private constructor(
    private readonly request: RenderDelegationVisualizationRequest,
  ) {}

  static from(
    request: RenderDelegationVisualizationRequest,
  ): DelegationVisualization {
    return new DelegationVisualization(request);
  }

  public execute(): DelegationVisualizationDocument {
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
