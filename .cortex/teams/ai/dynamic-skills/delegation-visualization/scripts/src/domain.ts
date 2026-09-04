export const DELEGATION_VISUALIZATION_TASK_LIMIT = 64;
export const DELEGATION_VISUALIZATION_ID_LIMIT = 128;
export const DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT = 256;
export const DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT = 64 * 1_024;
export const DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT =
  8 * 1_024 * 1_024 + 64 * 1_024;

export enum DelegationVisualizationContractKind {
  Request = 'gizmo-delegation-visualization-v1',
  Result = 'gizmo-delegation-document-v1',
}

export enum DelegationVisualizationTeam {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  Security = 'security',
  Sre = 'sre',
  WebDevelopment = 'web-development',
}

export type DelegationVisualizationTask = {
  readonly id: string;
  readonly team: DelegationVisualizationTeam;
  readonly description: string;
  readonly dependencies: readonly string[];
};

export type RenderDelegationVisualizationRequest = {
  readonly kind: DelegationVisualizationContractKind.Request;
  readonly tasks: readonly DelegationVisualizationTask[];
};

export type DelegationVisualizationDocumentTaskArgs = {
  readonly id: string;
  readonly team: DelegationVisualizationTeam;
  readonly description: string;
  readonly dependsOn: readonly string[];
};

export class DelegationVisualizationDocumentTask {
  readonly id: string;
  readonly team: DelegationVisualizationTeam;
  readonly description: string;
  readonly depends_on: readonly string[];

  constructor(args: DelegationVisualizationDocumentTaskArgs) {
    this.id = args.id;
    this.team = args.team;
    this.description = args.description;
    this.depends_on = args.dependsOn;
  }
}

export class DelegationVisualizationGizmoDocument {
  readonly tasks: readonly DelegationVisualizationDocumentTask[];

  constructor(tasks: readonly DelegationVisualizationDocumentTask[]) {
    this.tasks = tasks;
  }
}

export class DelegationVisualizationDocument {
  readonly gizmo: DelegationVisualizationGizmoDocument;

  constructor(tasks: readonly DelegationVisualizationDocumentTask[]) {
    this.gizmo = new DelegationVisualizationGizmoDocument(tasks);
  }
}

export type DelegationVisualizationResult = {
  readonly kind: DelegationVisualizationContractKind.Result;
  readonly document: DelegationVisualizationDocument;
};
