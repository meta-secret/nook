import { err, ok, type Result } from 'neverthrow';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
  DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT,
  DELEGATION_VISUALIZATION_ID_LIMIT,
  DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT,
  DELEGATION_VISUALIZATION_TASK_LIMIT,
  type DelegationVisualizationTask,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

export class DelegationVisualizationRequestDecoder {
  private isTransportRecord(
    value: unknown,
  ): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private constructor(private readonly request: string) {}

  static from(serialized: string): DelegationVisualizationRequestDecoder {
    return new DelegationVisualizationRequestDecoder(serialized);
  }

  public execute(): Result<
    RenderDelegationVisualizationRequest,
    DelegationVisualizationRequestDecodeError
  > {
    const serialized = this.request;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT
    ) {
      return err(new DelegationVisualizationRequestDecodeError(''));
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      return err(new DelegationVisualizationRequestDecodeError(''));
    }
    if (!this.isTransportRecord(transport)) {
      return err(new DelegationVisualizationRequestDecodeError(''));
    }
    const requestKeys: ExactRequestKeys = {
      value: transport,
      expected: Object.values(DelegationVisualizationRequestField),
    };
    if (!this.exactRequestKeys(requestKeys))
      return err(new DelegationVisualizationRequestDecodeError(''));
    if (transport.kind !== DelegationVisualizationContractKind.Request) {
      return err(new DelegationVisualizationRequestDecodeError('kind'));
    }
    if (
      !Array.isArray(transport.tasks) ||
      transport.tasks.length < 1 ||
      transport.tasks.length > DELEGATION_VISUALIZATION_TASK_LIMIT
    ) {
      return err(new DelegationVisualizationRequestDecodeError('tasks'));
    }
    const tasks: DelegationVisualizationTask[] = [];
    const priorTaskIds = new Set<string>();
    for (const [index, candidate] of transport.tasks.entries()) {
      const task = this.decodeTask({
        candidate,
        index,
        priorTaskIds,
      });
      if (task.isErr()) return err(task.error);
      tasks.push(task.value);
      priorTaskIds.add(task.value.id);
    }
    return ok({ kind: DelegationVisualizationContractKind.Request, tasks });
  }

  private decodeTask(
    request: DecodeDelegationVisualizationTaskRequest,
  ): Result<
    DelegationVisualizationTask,
    DelegationVisualizationRequestDecodeError
  > {
    const path = `tasks[${request.index}]`;
    if (!this.isTransportRecord(request.candidate)) {
      return err(new DelegationVisualizationRequestDecodeError(path));
    }
    const taskKeys: ExactTaskKeys = {
      value: request.candidate,
      expected: Object.values(DelegationVisualizationTaskField),
    };
    if (!this.exactTaskKeys(taskKeys))
      return err(new DelegationVisualizationRequestDecodeError(path));
    const { id, team, description, dependencies } = request.candidate;
    if (
      typeof id !== 'string' ||
      id.length > DELEGATION_VISUALIZATION_ID_LIMIT ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) ||
      request.priorTaskIds.has(id)
    ) {
      return err(new DelegationVisualizationRequestDecodeError(`${path}.id`));
    }
    if (!this.isDelegationTeam(team)) {
      return err(new DelegationVisualizationRequestDecodeError(`${path}.team`));
    }
    if (
      typeof description !== 'string' ||
      description.trim() !== description ||
      description.length < 1 ||
      description.length > DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT ||
      /[\r\n\u0000-\u001f\u007f-\u009f]/u.test(description)
    ) {
      return err(
        new DelegationVisualizationRequestDecodeError(`${path}.description`),
      );
    }
    if (!Array.isArray(dependencies)) {
      return err(
        new DelegationVisualizationRequestDecodeError(`${path}.dependencies`),
      );
    }
    const seenDependencies = new Set<string>();
    const decodedDependencies: string[] = [];
    for (const [dependencyIndex, dependency] of dependencies.entries()) {
      if (
        typeof dependency !== 'string' ||
        !request.priorTaskIds.has(dependency) ||
        seenDependencies.has(dependency)
      ) {
        return err(
          new DelegationVisualizationRequestDecodeError(
            `${path}.dependencies[${dependencyIndex}]`,
          ),
        );
      }
      seenDependencies.add(dependency);
      decodedDependencies.push(dependency);
    }
    return ok({ id, team, description, dependencies: decodedDependencies });
  }

  private isDelegationTeam(
    value: unknown,
  ): value is DelegationVisualizationTeam {
    return (
      typeof value === 'string' &&
      Object.values(DelegationVisualizationTeam).some((team) => team === value)
    );
  }

  private exactRequestKeys(request: ExactRequestKeys): boolean {
    if (!this.isTransportRecord(request.value)) return false;
    const keys = Object.keys(request.value);
    return (
      keys.length === request.expected.length &&
      keys.every((key) => request.expected.some((expected) => expected === key))
    );
  }

  private exactTaskKeys(request: ExactTaskKeys): boolean {
    if (!this.isTransportRecord(request.value)) return false;
    const keys = Object.keys(request.value);
    return (
      keys.length === request.expected.length &&
      keys.every((key) => request.expected.some((expected) => expected === key))
    );
  }
}

enum DelegationVisualizationRequestField {
  Kind = 'kind',
  Tasks = 'tasks',
}

enum DelegationVisualizationTaskField {
  Id = 'id',
  Team = 'team',
  Description = 'description',
  Dependencies = 'dependencies',
}

type ExactRequestKeys = {
  readonly value: Readonly<Record<string, unknown>>;
  readonly expected: readonly DelegationVisualizationRequestField[];
};

type ExactTaskKeys = {
  readonly value: Readonly<Record<string, unknown>>;
  readonly expected: readonly DelegationVisualizationTaskField[];
};

const UTF8_ENCODER = new TextEncoder();

export class DelegationVisualizationRequestDecodeError {
  readonly path: string;
  readonly message: string;
  readonly name: string;

  constructor(path: string) {
    this.message = 'Invalid delegation visualization request.';
    this.name = 'DelegationVisualizationRequestDecodeError';
    this.path = path;
  }
}

type DecodeDelegationVisualizationTaskRequest = {
  readonly candidate: unknown;
  readonly index: number;
  readonly priorTaskIds: ReadonlySet<string>;
};
