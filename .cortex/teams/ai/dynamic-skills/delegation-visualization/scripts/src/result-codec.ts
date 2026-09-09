import { err, ok, type Result } from 'neverthrow';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationDocument,
  DelegationVisualizationDocumentTask,
  DelegationVisualizationGizmoDocument,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

export class DelegationVisualizationVerifier {
  private constructor(
    private readonly request: VerifyDelegationVisualizationResultRequest,
  ) {}

  static from(
    input: VerifyDelegationVisualizationResultRequest,
  ): DelegationVisualizationVerifier {
    return new DelegationVisualizationVerifier(input);
  }

  public execute(): Result<
    DelegationVisualizationResult,
    DelegationVisualizationResultVerificationError
  > {
    const input = this.request;
    if (
      input.result.kind !== DelegationVisualizationContractKind.Result ||
      !this.hasExactKeys({
        value: input.result,
        expected: Object.values(DelegationVisualizationResultField),
      }) ||
      !(input.result.document instanceof DelegationVisualizationDocument) ||
      !this.hasExactKeys({
        value: input.result.document,
        expected: Object.values(DelegationVisualizationDocumentField),
      }) ||
      !(
        input.result.document.gizmo instanceof
        DelegationVisualizationGizmoDocument
      ) ||
      !this.hasExactKeys({
        value: input.result.document.gizmo,
        expected: Object.values(DelegationVisualizationGizmoField),
      })
    ) {
      return err(new DelegationVisualizationResultVerificationError());
    }
    const actualTasks = input.result.document.gizmo.tasks;
    if (actualTasks.length !== input.request.tasks.length) {
      return err(new DelegationVisualizationResultVerificationError());
    }
    const actualTaskIterator = actualTasks.values();
    for (const expected of input.request.tasks) {
      const actual = actualTaskIterator.next().value;
      if (
        !(actual instanceof DelegationVisualizationDocumentTask) ||
        !this.hasExactKeys({
          value: actual,
          expected: Object.values(DelegationVisualizationDocumentTaskField),
        }) ||
        actual.id !== expected.id ||
        actual.team !== expected.team ||
        actual.description !== expected.description ||
        !this.sameDependencies({
          actual: actual.depends_on,
          expected: expected.dependencies,
        })
      ) {
        return err(new DelegationVisualizationResultVerificationError());
      }
    }
    return ok(input.result);
  }

  private sameDependencies(input: SameDependenciesInput): boolean {
    if (input.actual.length !== input.expected.length) return false;
    const actualDependencyIterator = input.actual.values();
    for (const dependency of input.expected) {
      if (actualDependencyIterator.next().value !== dependency) return false;
    }
    return true;
  }

  private hasExactKeys(input: ExactKeysInput): boolean {
    const keys = Object.keys(input.value);
    return (
      keys.length === input.expected.length &&
      keys.every((key) => input.expected.includes(key))
    );
  }
}

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

export class DelegationVisualizationResultVerificationError {
  readonly message: string;
  readonly name: string;
  constructor() {
    this.message = 'Invalid delegation visualization result.';
    this.name = 'DelegationVisualizationResultVerificationError';
  }
}

type VerifyDelegationVisualizationResultRequest = {
  readonly request: RenderDelegationVisualizationRequest;
  readonly result: DelegationVisualizationResult;
};

type SameDependenciesInput = {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
};
