import ts from 'typescript';

export enum SubprocessCallKind {
  Bun = 'bun',
  BunShell = 'bunShell',
  Exec = 'exec',
  ExecFile = 'execFile',
  Fork = 'fork',
  Namespace = 'namespace',
  ReflectApply = 'reflectApply',
  ReflectConstruct = 'reflectConstruct',
  ReflectDynamic = 'reflectDynamic',
  ReflectNamespace = 'reflectNamespace',
  RunCommand = 'runCommand',
  Spawn = 'spawn',
  Worker = 'worker',
  WorkerNamespace = 'workerNamespace',
}

export const CHILD_PROCESS_CALLS = new Map<string, SubprocessCallKind>([
  ['spawn', SubprocessCallKind.Spawn],
  ['spawnSync', SubprocessCallKind.Spawn],
  ['execFile', SubprocessCallKind.ExecFile],
  ['execFileSync', SubprocessCallKind.ExecFile],
  ['exec', SubprocessCallKind.Exec],
  ['execSync', SubprocessCallKind.Exec],
  ['fork', SubprocessCallKind.Fork],
]);

export const WORKER_THREAD_CALLS = new Map<string, SubprocessCallKind>([
  ['Worker', SubprocessCallKind.Worker],
]);

export type TaggedTemplateText = {
  readonly dynamic: boolean;
  readonly value: string;
};

export type BunShellTemplateRequest = {
  readonly capability: SubprocessCallKind | false;
  readonly evaluate: (expression: ts.Expression) => TaggedTemplateText;
  readonly tagged: ts.TaggedTemplateExpression;
};

export type SerializedSubprocessCommand = {
  readonly cwd: TaggedTemplateText | false;
  readonly shellSource: boolean;
  readonly words: readonly TaggedTemplateText[];
};
export type SubprocessCwdRequest = {
  readonly allowDynamicCwd: boolean;
  readonly call: ts.CallExpression | ts.NewExpression;
  readonly evaluate: (expression: ts.Expression) => TaggedTemplateText;
  readonly kind: SubprocessCallKind;
  readonly resolveObject: (
    expression: ts.Expression,
  ) => ts.ObjectLiteralExpression | false;
  readonly sourcePath: string;
};
type ChildProcessMemberRequest = readonly [
  SubprocessCallKind | false,
  string | false,
];

export function bunShellTemplateCommand(
  request: BunShellTemplateRequest,
): string | false {
  const tag = request.tagged.tag;
  if (
    request.capability !== SubprocessCallKind.BunShell ||
    (!ts.isPropertyAccessExpression(tag) &&
      !ts.isElementAccessExpression(tag) &&
      !ts.isIdentifier(tag))
  )
    return false;
  const template = request.tagged.template;
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  let command = template.head.text;
  for (const span of template.templateSpans) {
    const value = request.evaluate(span.expression);
    if (value.dynamic)
      throw new Error('Dynamic Bun.$ subprocess shell source is forbidden.');
    command += shellQuote(value.value) + span.literal.text;
  }
  return command;
}

export function staticMemberAccess(
  expression: ts.Expression,
): readonly [ts.Expression, string | false] | false {
  if (ts.isPropertyAccessExpression(expression))
    return [expression.expression, expression.name.text];
  if (ts.isElementAccessExpression(expression))
    return [
      expression.expression,
      ts.isStringLiteral(expression.argumentExpression)
        ? expression.argumentExpression.text
        : false,
    ];
  return false;
}

export function childProcessCapability(
  request: ChildProcessMemberRequest,
): SubprocessCallKind | false {
  const [owner, member] = request;
  if (owner !== SubprocessCallKind.Namespace) return false;
  if (member === false)
    throw new Error('Dynamic child-process method selection is forbidden.');
  return CHILD_PROCESS_CALLS.get(member) ?? false;
}

export function workerThreadCapability(
  request: ChildProcessMemberRequest,
): SubprocessCallKind | false {
  const [owner, member] = request;
  if (owner !== SubprocessCallKind.WorkerNamespace) return false;
  if (member === false)
    throw new Error('Dynamic worker-thread member selection is forbidden.');
  return WORKER_THREAD_CALLS.get(member) ?? false;
}

export function functionInvocationCapability(
  request: ChildProcessMemberRequest,
): false {
  const [owner, member] = request;
  if (
    owner === false ||
    owner === SubprocessCallKind.Namespace ||
    owner === SubprocessCallKind.WorkerNamespace
  )
    return false;
  if (member === false)
    throw new Error(
      'Dynamic subprocess function member selection is forbidden.',
    );
  if (/^(?:apply|bind|call)$/u.test(member))
    throw new Error('Indirect subprocess function invocation is forbidden.');
  return false;
}

export function reflectInvocationCapability(
  request: ChildProcessMemberRequest,
): SubprocessCallKind | false {
  const [owner, member] = request;
  if (owner !== SubprocessCallKind.ReflectNamespace) return false;
  if (member === false) return SubprocessCallKind.ReflectDynamic;
  if (member === 'apply') return SubprocessCallKind.ReflectApply;
  return member === 'construct' ? SubprocessCallKind.ReflectConstruct : false;
}

export function isReflectInvocation(kind: SubprocessCallKind): boolean {
  return (
    kind === SubprocessCallKind.ReflectApply ||
    kind === SubprocessCallKind.ReflectConstruct ||
    kind === SubprocessCallKind.ReflectDynamic
  );
}

export function assertReflectInvocationTarget([adapter, target]: readonly [
  SubprocessCallKind,
  SubprocessCallKind | false,
]): void {
  if (
    target === false ||
    target === SubprocessCallKind.Namespace ||
    target === SubprocessCallKind.WorkerNamespace ||
    target === SubprocessCallKind.ReflectNamespace
  )
    return;
  if (adapter === SubprocessCallKind.ReflectDynamic)
    throw new Error(
      'Dynamic Reflect subprocess member selection is forbidden.',
    );
  throw new Error('Indirect Reflect subprocess invocation is forbidden.');
}

export function exactObjectProperty([object, name]: readonly [
  ts.ObjectLiteralExpression,
  string,
]): ts.Expression | false {
  const matches = object.properties.filter(
    (candidate) =>
      candidate.name &&
      (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
      candidate.name.text === name,
  );
  const match = matches[0];
  if (matches.length !== 1 || !match) return false;
  if (ts.isPropertyAssignment(match)) return match.initializer;
  return ts.isShorthandPropertyAssignment(match) ? match.name : false;
}

export function isStaticWorkerThreadsRequire(
  expression: ts.Expression,
): boolean {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'require' ||
    expression.arguments.length !== 1
  )
    return false;
  const [specifier] = expression.arguments;
  return Boolean(
    specifier &&
    ts.isStringLiteral(specifier) &&
    /^(?:node:)?worker_threads$/u.test(specifier.text),
  );
}

export function serializeSubprocessCommand(
  command: SerializedSubprocessCommand,
): string {
  const source = command.shellSource
    ? (command.words[0]?.value ?? '')
    : command.words
        .map((word) => {
          const escaped = word.value.replaceAll("'", "'\\''");
          return word.dynamic ? `"\${DYNAMIC:-${escaped}}"` : `'${escaped}'`;
        })
        .join(' ');
  return command.cwd === false
    ? source
    : `cd ${shellQuote(command.cwd.value)} && ${source}`;
}

export function subprocessCwd(
  request: SubprocessCwdRequest,
): TaggedTemplateText | false {
  const args = request.call.arguments ?? [];
  const first = args[0];
  let options: ts.Expression | false = false;
  if (request.kind === SubprocessCallKind.Bun) {
    options =
      first && request.resolveObject(first) !== false
        ? first
        : (args[1] ?? false);
  } else if (request.kind === SubprocessCallKind.Exec) {
    options = args[1] ?? false;
  } else if (
    request.kind === SubprocessCallKind.ExecFile ||
    request.kind === SubprocessCallKind.Fork ||
    request.kind === SubprocessCallKind.Spawn
  ) {
    const second = args[1];
    options =
      second && request.resolveObject(second) !== false
        ? second
        : (args[2] ?? false);
  }
  if (
    options === false ||
    ts.isArrowFunction(options) ||
    ts.isFunctionExpression(options)
  )
    return false;
  const object = request.resolveObject(options);
  if (object === false)
    throw new Error('Dynamic TypeScript subprocess options are forbidden.');
  if (object.properties.some((property) => ts.isSpreadAssignment(property)))
    throw new Error('Spread TypeScript subprocess cwd options are forbidden.');
  const cwd = exactObjectProperty([object, 'cwd']);
  if (cwd === false) return false;
  const evaluated = request.evaluate(cwd);
  if (evaluated.dynamic && !request.allowDynamicCwd)
    throw new Error(
      `Dynamic TypeScript subprocess cwd is forbidden in ${request.sourcePath}.`,
    );
  return evaluated.dynamic ? false : evaluated;
}

export function subprocessArgumentList(
  request: SubprocessCwdRequest,
): ts.Expression | false {
  const second = request.call.arguments?.[1];
  if (!second) return false;
  return request.kind !== SubprocessCallKind.Exec &&
    request.resolveObject(second) !== false
    ? false
    : second;
}

export function isSuccessorFreeExternalCommand(
  command: SerializedSubprocessCommand,
): boolean {
  const executable = command.words[0];
  return Boolean(
    !command.shellSource &&
    executable &&
    !executable.dynamic &&
    /^(?:cargo|git|tar|zip)$/u.test(executable.value),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
