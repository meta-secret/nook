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
  private static isTransportRecord(
    value: unknown,
  ): value is { readonly [key: string]: unknown } {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private constructor(private readonly request: string) {}

  static from(serialized: string): DelegationVisualizationRequestDecoder {
    return new DelegationVisualizationRequestDecoder(serialized);
  }

  public execute(): RenderDelegationVisualizationRequest {
    const serialized = this.request;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT
    ) {
      throw new DelegationVisualizationRequestDecodeError('');
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      throw new DelegationVisualizationRequestDecodeError('');
    }
    const requestKeys: ExactRequestKeys = {
      value: transport,
      expected: Object.values(DelegationVisualizationRequestField),
    };
    if (
      !DelegationVisualizationRequestDecoder.isTransportRecord(transport) ||
      !DelegationVisualizationRequestDecoder.exactRequestKeys(requestKeys)
    ) {
      throw new DelegationVisualizationRequestDecodeError('');
    }
    if (transport.kind !== DelegationVisualizationContractKind.Request) {
      throw new DelegationVisualizationRequestDecodeError('kind');
    }
    if (
      !Array.isArray(transport.tasks) ||
      transport.tasks.length < 1 ||
      transport.tasks.length > DELEGATION_VISUALIZATION_TASK_LIMIT
    ) {
      throw new DelegationVisualizationRequestDecodeError('tasks');
    }
    const tasks: DelegationVisualizationTask[] = [];
    const priorTaskIds = new Set<string>();
    for (const [index, candidate] of transport.tasks.entries()) {
      const task = DelegationVisualizationRequestDecoder.decodeTask({
        candidate,
        index,
        priorTaskIds,
      });
      tasks.push(task);
      priorTaskIds.add(task.id);
    }
    return { kind: DelegationVisualizationContractKind.Request, tasks };
  }

  private static decodeTask(
    request: DecodeDelegationVisualizationTaskRequest,
  ): DelegationVisualizationTask {
    const path = `tasks[${request.index}]`;
    const taskKeys: ExactTaskKeys = {
      value: request.candidate,
      expected: Object.values(DelegationVisualizationTaskField),
    };
    if (
      !DelegationVisualizationRequestDecoder.isTransportRecord(
        request.candidate,
      ) ||
      !DelegationVisualizationRequestDecoder.exactTaskKeys(taskKeys)
    ) {
      throw new DelegationVisualizationRequestDecodeError(path);
    }
    const { id, team, description, dependencies } = request.candidate;
    if (
      typeof id !== 'string' ||
      id.length > DELEGATION_VISUALIZATION_ID_LIMIT ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) ||
      request.priorTaskIds.has(id)
    ) {
      throw new DelegationVisualizationRequestDecodeError(`${path}.id`);
    }
    if (!DelegationVisualizationRequestDecoder.isDelegationTeam(team)) {
      throw new DelegationVisualizationRequestDecodeError(`${path}.team`);
    }
    if (
      typeof description !== 'string' ||
      description.trim() !== description ||
      description.length < 1 ||
      description.length > DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT ||
      /[\r\n\u0000-\u001f\u007f-\u009f]/u.test(description)
    ) {
      throw new DelegationVisualizationRequestDecodeError(
        `${path}.description`,
      );
    }
    if (!Array.isArray(dependencies)) {
      throw new DelegationVisualizationRequestDecodeError(
        `${path}.dependencies`,
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
        throw new DelegationVisualizationRequestDecodeError(
          `${path}.dependencies[${dependencyIndex}]`,
        );
      }
      seenDependencies.add(dependency);
      decodedDependencies.push(dependency);
    }
    return { id, team, description, dependencies: decodedDependencies };
  }

  private static isDelegationTeam(
    value: unknown,
  ): value is DelegationVisualizationTeam {
    return (
      typeof value === 'string' &&
      Object.values(DelegationVisualizationTeam).some((team) => team === value)
    );
  }

  private static exactRequestKeys(request: ExactRequestKeys): boolean {
    if (!DelegationVisualizationRequestDecoder.isTransportRecord(request.value))
      return false;
    const keys = Object.keys(request.value);
    return (
      keys.length === request.expected.length &&
      keys.every((key) => request.expected.some((expected) => expected === key))
    );
  }

  private static exactTaskKeys(request: ExactTaskKeys): boolean {
    if (!DelegationVisualizationRequestDecoder.isTransportRecord(request.value))
      return false;
    const keys = Object.keys(request.value);
    return (
      keys.length === request.expected.length &&
      keys.every((key) => request.expected.includes(key as never))
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
  readonly value: unknown;
  readonly expected: readonly DelegationVisualizationRequestField[];
};

type ExactTaskKeys = {
  readonly value: unknown;
  readonly expected: readonly DelegationVisualizationTaskField[];
};

const UTF8_ENCODER = new TextEncoder();

export class DelegationVisualizationRequestDecodeError extends Error {
  readonly path: string;

  constructor(path: string) {
    super('Invalid delegation visualization request.');
    this.name = 'DelegationVisualizationRequestDecodeError';
    this.path = path;
  }
}

type DecodeDelegationVisualizationTaskRequest = {
  readonly candidate: unknown;
  readonly index: number;
  readonly priorTaskIds: ReadonlySet<string>;
};
