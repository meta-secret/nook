import ts from 'typescript';

export enum SubprocessCallKind {
  Bun = 'bun',
  BunNamespace = 'bunNamespace',
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
  readonly allowDynamicEnvironment: boolean;
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
export type UnsupportedCallArgumentRequest = {
  readonly call: string;
  readonly capability: (
    expression: ts.Expression,
  ) => SubprocessCallKind | false;
  readonly expression: ts.Expression;
  readonly resolve: (expression: ts.Expression) => ts.Expression;
  readonly sourcePath: string;
};

export function unwrapTypescriptExpression(
  expression: ts.Expression,
): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression)
  )
    return unwrapTypescriptExpression(expression.expression);
  return expression;
}

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

export function bunNamespaceCapability(
  request: ChildProcessMemberRequest,
): SubprocessCallKind | false {
  const [owner, member] = request;
  if (owner !== SubprocessCallKind.BunNamespace) return false;
  if (member === false)
    throw new Error('Dynamic Bun namespace member selection is forbidden.');
  return member === '$' ? SubprocessCallKind.BunShell : false;
}

export function functionInvocationCapability(
  request: ChildProcessMemberRequest,
): false {
  const [owner, member] = request;
  if (
    owner === false ||
    owner === SubprocessCallKind.BunNamespace ||
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

export function assertUnsupportedCallCapability([
  capability,
  sourcePath,
  call,
]: readonly [SubprocessCallKind | false, string, string]): void {
  if (
    capability === false ||
    capability === SubprocessCallKind.ReflectApply ||
    capability === SubprocessCallKind.ReflectConstruct ||
    capability === SubprocessCallKind.ReflectDynamic ||
    capability === SubprocessCallKind.ReflectNamespace
  )
    return;
  throw new Error(
    `Subprocess capability passed to unsupported call in ${sourcePath}: ${call}`,
  );
}

export function assertUnsupportedCallArgument(
  request: UnsupportedCallArgumentRequest,
): void {
  assertNestedCallArgument([request, new Set()]);
}

function assertNestedCallArgument([request, visited]: readonly [
  UnsupportedCallArgumentRequest,
  ReadonlySet<ts.Expression>,
]): void {
  if (visited.has(request.expression)) return;
  const nextVisited = new Set(visited).add(request.expression);
  assertUnsupportedCallCapability([
    request.capability(request.expression),
    request.sourcePath,
    request.call,
  ]);
  const resolved = request.resolve(request.expression);
  if (resolved !== request.expression) {
    assertNestedCallArgument([
      { ...request, expression: resolved },
      nextVisited,
    ]);
    return;
  }
  const nested: ts.Expression[] = [];
  if (ts.isArrayLiteralExpression(resolved)) {
    for (const element of resolved.elements)
      nested.push(ts.isSpreadElement(element) ? element.expression : element);
  }
  if (ts.isObjectLiteralExpression(resolved)) {
    for (const property of resolved.properties) {
      if (ts.isPropertyAssignment(property)) nested.push(property.initializer);
      if (ts.isShorthandPropertyAssignment(property))
        nested.push(property.name);
      if (ts.isSpreadAssignment(property)) nested.push(property.expression);
      if (
        (ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property) ||
          ts.isMethodDeclaration(property)) &&
        property.body
      )
        ts.forEachChild(property.body, (node) =>
          inspectDeferredAggregateNode([request, nextVisited, node]),
        );
    }
  }
  for (const expression of nested)
    assertNestedCallArgument([{ ...request, expression }, nextVisited]);
}

function inspectDeferredAggregateNode([request, visited, node]: readonly [
  UnsupportedCallArgumentRequest,
  ReadonlySet<ts.Expression>,
  ts.Node,
]): void {
  if (ts.isExpression(node))
    assertNestedCallArgument([{ ...request, expression: node }, visited]);
  ts.forEachChild(node, (child) =>
    inspectDeferredAggregateNode([request, visited, child]),
  );
}

export function dynamicImportCapability(
  expression: ts.Expression,
): SubprocessCallKind | false {
  if (
    !ts.isCallExpression(expression) ||
    expression.expression.kind !== ts.SyntaxKind.ImportKeyword
  )
    return false;
  const [specifier] = expression.arguments;
  if (!specifier || !ts.isStringLiteral(specifier)) return false;
  if (/^(?:node:)?child_process$/u.test(specifier.text))
    return SubprocessCallKind.Namespace;
  return /^(?:node:)?worker_threads$/u.test(specifier.text)
    ? SubprocessCallKind.WorkerNamespace
    : false;
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
  const object = subprocessOptionsObject(request);
  if (object === false) return false;
  assertSubprocessEnvironment([request, object]);
  const cwd = exactObjectProperty([object, 'cwd']);
  if (cwd === false) return false;
  const evaluated = request.evaluate(cwd);
  if (evaluated.dynamic && !request.allowDynamicCwd)
    throw new Error(
      `Dynamic TypeScript subprocess cwd is forbidden in ${request.sourcePath}.`,
    );
  return evaluated.dynamic ? false : evaluated;
}

export function auditSubprocessEnvironment(
  request: SubprocessCwdRequest,
): void {
  const object = subprocessOptionsObject(request);
  if (object !== false) assertSubprocessEnvironment([request, object]);
}

function subprocessOptionsObject(
  request: SubprocessCwdRequest,
): ts.ObjectLiteralExpression | false {
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
  } else if (request.kind === SubprocessCallKind.Worker) {
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
    ((ts.isArrowFunction(options) || ts.isFunctionExpression(options)) &&
      request.kind !== SubprocessCallKind.Worker)
  )
    return false;
  const object = request.resolveObject(options);
  if (object === false)
    throw new Error('Dynamic TypeScript subprocess options are forbidden.');
  if (object.properties.some((property) => ts.isSpreadAssignment(property)))
    throw new Error('Spread TypeScript subprocess cwd options are forbidden.');
  return object;
}

function assertSubprocessEnvironment([request, object]: readonly [
  SubprocessCwdRequest,
  ts.ObjectLiteralExpression,
]): void {
  if (
    object.properties.some(
      (property) => property.name && ts.isComputedPropertyName(property.name),
    )
  )
    throw new Error('Dynamic TypeScript subprocess environment is forbidden.');
  const environment = exactObjectProperty([object, 'env']);
  const environmentProperties = object.properties.filter(
    (property) =>
      property.name &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'env',
  );
  if (environment === false && environmentProperties.length > 0)
    throw new Error('Dynamic TypeScript subprocess environment is forbidden.');
  if (environment !== false) {
    if (!ts.isObjectLiteralExpression(environment)) {
      if (request.allowDynamicEnvironment) return;
      throw new Error(
        `Dynamic TypeScript subprocess environment is forbidden in ${request.sourcePath}.`,
      );
    }
    const names = new Set<string>();
    for (const property of environment.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteral(property.name)) ||
        names.has(property.name.text)
      )
        throw new Error(
          `Dynamic TypeScript subprocess environment is forbidden in ${request.sourcePath}.`,
        );
      if (!isSafeSubprocessEnvironmentKey(property.name.text))
        throw new Error(
          `Unsafe TypeScript subprocess environment key ${property.name.text} in ${request.sourcePath}.`,
        );
      const pathEnvironmentKey =
        property.name.text === PlatformPathEnvironmentKey.Posix
          ? PlatformPathEnvironmentKey.Posix
          : property.name.text === PlatformPathEnvironmentKey.Windows
            ? PlatformPathEnvironmentKey.Windows
            : false;
      if (
        pathEnvironmentKey !== false &&
        !isPlatformPathEnvironmentValue({
          value: property.initializer,
          name: pathEnvironmentKey,
        })
      )
        throw new Error(
          `Unsafe TypeScript subprocess PATH value in ${request.sourcePath}.`,
        );
      if (
        pathEnvironmentKey === false &&
        !isSafeSubprocessEnvironmentValue({
          name: property.name.text,
          value: property.initializer,
        })
      )
        throw new Error(
          `Unsafe TypeScript subprocess environment value for ${property.name.text} in ${request.sourcePath}.`,
        );
      names.add(property.name.text);
    }
  }
  const shell = exactObjectProperty([object, 'shell']);
  const shellProperties = object.properties.filter(
    (property) =>
      property.name &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'shell',
  );
  if (
    shellProperties.length > 0 &&
    (shell === false || shell.kind !== ts.SyntaxKind.FalseKeyword)
  )
    throw new Error(
      `Shell-enabled TypeScript subprocess options are forbidden in ${request.sourcePath}.`,
    );
  if (request.kind !== SubprocessCallKind.Worker) return;
  const execArgv = exactObjectProperty([object, 'execArgv']);
  const execArgvProperties = object.properties.filter(
    (property) =>
      property.name &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'execArgv',
  );
  if (
    execArgvProperties.length > 0 &&
    (execArgv === false ||
      !ts.isArrayLiteralExpression(execArgv) ||
      execArgv.elements.length > 0)
  )
    throw new Error(
      `TypeScript Worker execArgv authority is forbidden in ${request.sourcePath}.`,
    );
  const evaluate = exactObjectProperty([object, 'eval']);
  const evaluateProperties = object.properties.filter(
    (property) =>
      property.name &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'eval',
  );
  if (
    evaluateProperties.length > 0 &&
    (evaluate === false || evaluate.kind !== ts.SyntaxKind.FalseKeyword)
  )
    throw new Error(
      `TypeScript Worker eval authority is forbidden in ${request.sourcePath}.`,
    );
}

type SafeSubprocessEnvironmentValueRequest = {
  readonly name: string;
  readonly value: ts.Expression;
};

function isSafeSubprocessEnvironmentValue(
  request: SafeSubprocessEnvironmentValueRequest,
): boolean {
  const { name, value } = request;
  const literals: Readonly<Record<string, string>> = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
  if (Object.hasOwn(literals, name))
    return ts.isStringLiteral(value) && value.text === literals[name];
  if (name === 'GIT_AUTHOR_DATE' || name === 'GIT_COMMITTER_DATE')
    return (
      (ts.isStringLiteral(value) && /^@[0-9]+ \+0000$/u.test(value.text)) ||
      isNamedPropertyAccess({ value, name: 'commitTimestamp' })
    );
  if (name === 'GIT_INDEX_FILE')
    return (
      ts.isStringLiteral(value) ||
      isNamedPropertyAccess({ value, name: 'indexFile' })
    );
  return isProcessEnvironmentAccess({ value, name });
}

function isNamedPropertyAccess(
  request: SafeSubprocessEnvironmentValueRequest,
): boolean {
  return (
    ts.isPropertyAccessExpression(request.value) &&
    request.value.name.text === request.name
  );
}

function isProcessEnvironmentAccess(
  request: SafeSubprocessEnvironmentValueRequest,
): boolean {
  const { value, name } = request;
  return (
    ts.isPropertyAccessExpression(value) &&
    value.name.text === name &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === 'env' &&
    ts.isIdentifier(value.expression.expression) &&
    value.expression.expression.text === 'process'
  );
}

enum PlatformPathEnvironmentKey {
  Posix = 'PATH',
  Windows = 'Path',
}

type PlatformPathEnvironmentValueRequest = {
  readonly value: ts.Expression;
  readonly name: PlatformPathEnvironmentKey;
};

function isPlatformPathEnvironmentValue(
  request: PlatformPathEnvironmentValueRequest,
): boolean {
  const { value, name } = request;
  return (
    (name === PlatformPathEnvironmentKey.Posix &&
      ts.isStringLiteral(value) &&
      value.text === '/bin:/usr/bin:/usr/sbin') ||
    (ts.isPropertyAccessExpression(value) &&
      value.name.text === name &&
      ts.isPropertyAccessExpression(value.expression) &&
      value.expression.name.text === 'env' &&
      ts.isIdentifier(value.expression.expression) &&
      value.expression.expression.text === 'process')
  );
}

function isSafeSubprocessEnvironmentKey(name: string): boolean {
  return (
    name === 'COMSPEC' ||
    name === 'GIT_AUTHOR_DATE' ||
    name === 'GIT_COMMITTER_DATE' ||
    name === 'GIT_CONFIG_GLOBAL' ||
    name === 'GIT_CONFIG_NOSYSTEM' ||
    name === 'GIT_INDEX_FILE' ||
    name === 'GIT_NO_REPLACE_OBJECTS' ||
    name === 'GIT_TERMINAL_PROMPT' ||
    name === 'LC_ALL' ||
    name === 'PATH' ||
    name === 'Path' ||
    name === 'PATHEXT' ||
    name === 'SYSTEMROOT' ||
    name === 'SystemRoot' ||
    name === 'WINDIR'
  );
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
  const successorFree = Boolean(
    !command.shellSource &&
    executable &&
    !executable.dynamic &&
    /^(?:cargo|git|tar|zip)$/u.test(executable.value),
  );
  if (!successorFree || !executable) return false;
  assertExternalCommandArguments([executable.value, command.words.slice(1)]);
  return true;
}

function assertExternalCommandArguments([executable, words]: readonly [
  string,
  readonly TaggedTemplateText[],
]): void {
  const values = words.map((word) => (word.dynamic ? false : word.value));
  if (executable === 'git') {
    assertGitSubcommandArguments(values);
    for (const [index, value] of values.entries()) {
      const next = values[index + 1];
      if (value === '-c' && (!next || gitConfigRunsCommand(next)))
        throw new Error('Command-capable git configuration is forbidden.');
      if (
        value &&
        value.startsWith('-c') &&
        gitConfigRunsCommand(value.slice(2))
      )
        throw new Error('Command-capable git configuration is forbidden.');
      if (
        value &&
        /^--(?:exec-path|receive-pack|upload-pack)(?:=|$)/u.test(value)
      )
        throw new Error('Command-capable git option is forbidden.');
      if (
        value &&
        /^alias\./iu.test(value) &&
        (next === false || next?.trimStart().startsWith('!'))
      )
        throw new Error('Command-capable git alias is forbidden.');
    }
  }
  if (
    executable === 'tar' &&
    values.some(
      (value) =>
        value !== false &&
        /^(?:-I|--checkpoint-action=exec|--info-script|--rsh-command|--to-command|--use-compress-program)(?:=|$)/u.test(
          value,
        ),
    )
  )
    throw new Error('Command-capable tar option is forbidden.');
}

function assertGitSubcommandArguments(
  values: readonly (string | false)[],
): void {
  const located = gitSubcommand(values);
  if (located === false) return;
  const [subcommand, index] = located;
  const args = values.slice(index + 1);
  if (
    /^(?:citool|difftool|filter-branch|for-each-repo|gui|instaweb|mergetool|p4|send-email|web--browse)$/u.test(
      subcommand,
    ) ||
    (subcommand === 'bisect' && args.includes('run')) ||
    (subcommand === 'submodule' && args.includes('foreach')) ||
    (subcommand === 'rebase' &&
      args.some(
        (value) =>
          value === '-x' ||
          (typeof value === 'string' && value.startsWith('--exec')),
      )) ||
    (subcommand === 'grep' &&
      args.some(
        (value) =>
          typeof value === 'string' &&
          value.startsWith('--open-files-in-pager'),
      )) ||
    (subcommand === 'help' &&
      args.some((value) => /^(?:-w|--web)(?:=|$)/u.test(value || '')))
  )
    throw new Error(
      `Command-capable git subcommand is forbidden: ${subcommand}`,
    );
  if (subcommand !== 'config') return;
  for (const [argumentIndex, value] of args.entries()) {
    if (
      value &&
      gitConfigKeyRunsCommand(value) &&
      argumentIndex + 1 < args.length
    )
      throw new Error('Command-capable git configuration is forbidden.');
  }
}

function gitSubcommand(
  values: readonly (string | false)[],
): readonly [string, number] | false {
  const consuming = new Set([
    '-C',
    '-c',
    '--config-env',
    '--git-dir',
    '--namespace',
    '--super-prefix',
    '--work-tree',
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'string') return false;
    if (consuming.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith('-')) continue;
    return [value, index];
  }
  return false;
}

function gitConfigRunsCommand(value: string): boolean {
  const separator = value.indexOf('=');
  if (separator < 1) return false;
  const key = value.slice(0, separator);
  const configured = value.slice(separator + 1).trimStart();
  return /^alias\./iu.test(key)
    ? configured.startsWith('!')
    : gitConfigKeyRunsCommand(key);
}

function gitConfigKeyRunsCommand(key: string): boolean {
  return /^(?:core\.sshcommand|diff\.external|difftool\..*\.cmd|filter\..*\.(?:clean|process|smudge)|mergetool\..*\.cmd)$/iu.test(
    key,
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
