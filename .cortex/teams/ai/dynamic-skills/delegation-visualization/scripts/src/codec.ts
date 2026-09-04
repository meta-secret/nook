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

type DelegationVisualizationTaskTransport = {
  readonly id: string | false;
  readonly team: string | false;
  readonly description: string | false;
  readonly dependencies: readonly (string | false)[] | false;
};

type DelegationVisualizationRequestTransport = {
  readonly kind: string | false;
  readonly tasks: readonly DelegationVisualizationTaskTransport[] | false;
};

type ExactRequestKeys = {
  readonly value: DelegationVisualizationRequestTransport;
  readonly expected: readonly DelegationVisualizationRequestField[];
};

type ExactTaskKeys = {
  readonly value: DelegationVisualizationTaskTransport;
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

export function decodeDelegationVisualizationRequest(
  serialized: string,
): RenderDelegationVisualizationRequest {
  if (
    UTF8_ENCODER.encode(serialized).byteLength >
    DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT
  ) {
    throw new DelegationVisualizationRequestDecodeError('');
  }
  let transport: DelegationVisualizationRequestTransport;
  try {
    transport = JSON.parse(
      serialized,
    ) as DelegationVisualizationRequestTransport;
  } catch {
    throw new DelegationVisualizationRequestDecodeError('');
  }
  const requestKeys: ExactRequestKeys = {
    value: transport,
    expected: Object.values(DelegationVisualizationRequestField),
  };
  if (!transport || !exactRequestKeys(requestKeys)) {
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
    const task = decodeTask({ candidate, index, priorTaskIds });
    tasks.push(task);
    priorTaskIds.add(task.id);
  }
  return { kind: DelegationVisualizationContractKind.Request, tasks };
}

type DecodeDelegationVisualizationTaskRequest = {
  readonly candidate: DelegationVisualizationTaskTransport;
  readonly index: number;
  readonly priorTaskIds: ReadonlySet<string>;
};

function decodeTask(
  request: DecodeDelegationVisualizationTaskRequest,
): DelegationVisualizationTask {
  const path = `tasks[${request.index}]`;
  const taskKeys: ExactTaskKeys = {
    value: request.candidate,
    expected: Object.values(DelegationVisualizationTaskField),
  };
  if (!request.candidate || !exactTaskKeys(taskKeys)) {
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
  if (!isDelegationTeam(team)) {
    throw new DelegationVisualizationRequestDecodeError(`${path}.team`);
  }
  if (
    typeof description !== 'string' ||
    description.trim() !== description ||
    description.length < 1 ||
    description.length > DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT ||
    /[\r\n\u0000-\u001f\u007f-\u009f]/u.test(description)
  ) {
    throw new DelegationVisualizationRequestDecodeError(`${path}.description`);
  }
  if (!Array.isArray(dependencies)) {
    throw new DelegationVisualizationRequestDecodeError(`${path}.dependencies`);
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

function isDelegationTeam(
  value: string | false,
): value is DelegationVisualizationTeam {
  return (
    typeof value === 'string' &&
    Object.values(DelegationVisualizationTeam).some((team) => team === value)
  );
}

function exactRequestKeys(request: ExactRequestKeys): boolean {
  const keys = Object.keys(request.value);
  return (
    keys.length === request.expected.length &&
    keys.every((key) => request.expected.includes(key as never))
  );
}

function exactTaskKeys(request: ExactTaskKeys): boolean {
  const keys = Object.keys(request.value);
  return (
    keys.length === request.expected.length &&
    keys.every((key) => request.expected.includes(key as never))
  );
}
