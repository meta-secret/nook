import ts from 'typescript';

export enum SubprocessCallKind {
  Bun = 'bun',
  BunShell = 'bunShell',
  Exec = 'exec',
  ExecFile = 'execFile',
  Fork = 'fork',
  Namespace = 'namespace',
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
  readonly shellSource: boolean;
  readonly words: readonly TaggedTemplateText[];
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

export function exactObjectProperty([object, name]: readonly [
  ts.ObjectLiteralExpression,
  string,
]): ts.Expression | false {
  const matches = object.properties.filter(
    (candidate) =>
      candidate.name !== undefined &&
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
  if (command.shellSource) return command.words[0]?.value ?? '';
  return command.words
    .map((word) => {
      const escaped = word.value.replaceAll("'", "'\\''");
      return word.dynamic ? `"\${DYNAMIC:-${escaped}}"` : `'${escaped}'`;
    })
    .join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
