export const DELEGATION_VISUALIZATION_TASK_LIMIT = 64;
export const DELEGATION_VISUALIZATION_ID_LIMIT = 128;
export const DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT = 256;
export const DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT = 64 * 1_024;
export const DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT = 64 * 1_024;

export enum DelegationVisualizationContractKind {
  Request = 'gizmo-delegation-visualization-v1',
  Result = 'gizmo-delegation-tree-v1',
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

export type DelegationVisualizationResult = {
  readonly kind: DelegationVisualizationContractKind.Result;
  readonly tree: string;
};
