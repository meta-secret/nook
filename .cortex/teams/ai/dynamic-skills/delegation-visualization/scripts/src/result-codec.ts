import {
  DelegationVisualizationContractKind,
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  DelegationVisualizationGizmoDocument,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

enum DelegationVisualizationResultField {
  Kind = 'kind',
  Document = 'document',
}

enum DelegationVisualizationDocumentField {
  Gizmo = 'gizmo',
}

enum DelegationVisualizationGizmoField {
  Tasks = 'tasks',
}

enum DelegationVisualizationDocumentTaskField {
  Id = 'id',
  Team = 'team',
  Description = 'description',
  DependsOn = 'depends_on',
}

type DelegationVisualizationResultValue =
  | DelegationVisualizationDocument
  | DelegationVisualizationDocumentTask
  | DelegationVisualizationGizmoDocument
  | DelegationVisualizationResult;

type ExactKeysInput = {
  readonly value: DelegationVisualizationResultValue;
  readonly expected: readonly string[];
};

export class DelegationVisualizationResultVerificationError extends Error {
  constructor() {
    super('Invalid delegation visualization result.');
    this.name = 'DelegationVisualizationResultVerificationError';
  }
}

type VerifyDelegationVisualizationResultRequest = {
  readonly request: RenderDelegationVisualizationRequest;
  readonly result: DelegationVisualizationResult;
};

export function verifyDelegationVisualizationResult(
  input: VerifyDelegationVisualizationResultRequest,
): DelegationVisualizationResult {
  if (
    input.result.kind !== DelegationVisualizationContractKind.Result ||
    !hasExactKeys({
      value: input.result,
      expected: Object.values(DelegationVisualizationResultField),
    }) ||
    !(input.result.document instanceof DelegationVisualizationDocument) ||
    !hasExactKeys({
      value: input.result.document,
      expected: Object.values(DelegationVisualizationDocumentField),
    }) ||
    !(
      input.result.document.gizmo instanceof
      DelegationVisualizationGizmoDocument
    ) ||
    !hasExactKeys({
      value: input.result.document.gizmo,
      expected: Object.values(DelegationVisualizationGizmoField),
    })
  ) {
    throw new DelegationVisualizationResultVerificationError();
  }
  const actualTasks = input.result.document.gizmo.tasks;
  if (actualTasks.length !== input.request.tasks.length) {
    throw new DelegationVisualizationResultVerificationError();
  }
  const actualTaskIterator = actualTasks.values();
  for (const expected of input.request.tasks) {
    const actual = actualTaskIterator.next().value;
    if (
      !(actual instanceof DelegationVisualizationDocumentTask) ||
      !hasExactKeys({
        value: actual,
        expected: Object.values(DelegationVisualizationDocumentTaskField),
      }) ||
      actual.id !== expected.id ||
      actual.team !== expected.team ||
      actual.description !== expected.description ||
      !sameDependencies({
        actual: actual.depends_on,
        expected: expected.dependencies,
      })
    ) {
      throw new DelegationVisualizationResultVerificationError();
    }
  }
  return input.result;
}

type SameDependenciesInput = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
};

function sameDependencies(input: SameDependenciesInput): boolean {
  if (input.actual.length !== input.expected.length) return false;
  const actualDependencyIterator = input.actual.values();
  for (const dependency of input.expected) {
    if (actualDependencyIterator.next().value !== dependency) return false;
  }
  return true;
}

function hasExactKeys(input: ExactKeysInput): boolean {
  const keys = Object.keys(input.value);
  return (
    keys.length === input.expected.length &&
    keys.every((key) => input.expected.includes(key))
  );
}
