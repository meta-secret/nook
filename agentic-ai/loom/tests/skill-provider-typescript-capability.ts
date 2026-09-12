import type {
  TaggedTemplateText,
  BunShellTemplateRequest,
  SerializedSubprocessCommand,
  SubprocessCwdRequest,
  ChildProcessMemberRequest,
  UnsupportedCallArgumentRequest,
  SafeSubprocessEnvironmentValueRequest,
  PlatformPathEnvironmentValueRequest,
} from './skill-provider-typescript-capability-contracts.ts';
import {
  SubprocessCallKind,
  PlatformPathEnvironmentKey,
} from './skill-provider-typescript-capability-contracts.ts';
export type {
  TaggedTemplateText,
  BunShellTemplateRequest,
  SerializedSubprocessCommand,
  SubprocessCwdRequest,
  UnsupportedCallArgumentRequest,
} from './skill-provider-typescript-capability-contracts.ts';
export { SubprocessCallKind } from './skill-provider-typescript-capability-contracts.ts';
import ts from 'typescript';

export class SkillProviderTypescriptCapabilityScenario {
  private constructor(private readonly request: ts.Expression) {}

  static unwrapTypescriptExpression(expression: ts.Expression): ts.Expression {
    return new SkillProviderTypescriptCapabilityScenario(expression).execute();
  }

  private execute(): ts.Expression {
    const expression = this.request;
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isAwaitExpression(expression)
    )
      return SkillProviderTypescriptCapabilityScenario.unwrapTypescriptExpression(
        expression.expression,
      );
    return expression;
  }

  static bunShellTemplateCommand(
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
      command +=
        SkillProviderTypescriptCapabilityScenario.shellQuote(value.value) +
        span.literal.text;
    }
    return command;
  }

  static staticMemberAccess(
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

  static childProcessCapability(
    request: ChildProcessMemberRequest,
  ): SubprocessCallKind | false {
    const [owner, member] = request;
    if (owner === SubprocessCallKind.HostCommand) {
      if (member === false)
        throw new Error('Dynamic host command method selection is forbidden.');
      return member === 'run' ? SubprocessCallKind.RunCommand : false;
    }
    if (owner !== SubprocessCallKind.Namespace) return false;
    if (member === false)
      throw new Error('Dynamic child-process method selection is forbidden.');
    const [defaulted1 = false] = [CHILD_PROCESS_CALLS.get(member)];
    return defaulted1;
  }

  static workerThreadCapability(
    request: ChildProcessMemberRequest,
  ): SubprocessCallKind | false {
    const [owner, member] = request;
    if (owner !== SubprocessCallKind.WorkerNamespace) return false;
    if (member === false)
      throw new Error('Dynamic worker-thread member selection is forbidden.');
    const [defaulted2 = false] = [WORKER_THREAD_CALLS.get(member)];
    return defaulted2;
  }

  static bunNamespaceCapability(
    request: ChildProcessMemberRequest,
  ): SubprocessCallKind | false {
    const [owner, member] = request;
    if (owner !== SubprocessCallKind.BunNamespace) return false;
    if (member === false)
      throw new Error('Dynamic Bun namespace member selection is forbidden.');
    return member === '$' ? SubprocessCallKind.BunShell : false;
  }

  static functionInvocationCapability(
    request: ChildProcessMemberRequest,
  ): false {
    const [owner, member] = request;
    if (
      owner === false ||
      owner === SubprocessCallKind.BunNamespace ||
      owner === SubprocessCallKind.Namespace ||
      owner === SubprocessCallKind.WorkerNamespace ||
      owner === SubprocessCallKind.HostCommand
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

  static reflectInvocationCapability(
    request: ChildProcessMemberRequest,
  ): SubprocessCallKind | false {
    const [owner, member] = request;
    if (owner !== SubprocessCallKind.ReflectNamespace) return false;
    if (member === false) return SubprocessCallKind.ReflectDynamic;
    if (member === 'apply') return SubprocessCallKind.ReflectApply;
    return member === 'construct' ? SubprocessCallKind.ReflectConstruct : false;
  }

  static isReflectInvocation(kind: SubprocessCallKind): boolean {
    return (
      kind === SubprocessCallKind.ReflectApply ||
      kind === SubprocessCallKind.ReflectConstruct ||
      kind === SubprocessCallKind.ReflectDynamic
    );
  }

  static assertReflectInvocationTarget([adapter, target]: readonly [
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

  static assertUnsupportedCallCapability([
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

  static assertUnsupportedCallArgument(
    request: UnsupportedCallArgumentRequest,
  ): void {
    SkillProviderTypescriptCapabilityScenario.assertNestedCallArgument([
      request,
      new Set(),
    ]);
  }

  static assertNestedCallArgument([request, visited]: readonly [
    UnsupportedCallArgumentRequest,
    ReadonlySet<ts.Expression>,
  ]): void {
    if (visited.has(request.expression)) return;
    const nextVisited = new Set(visited).add(request.expression);
    SkillProviderTypescriptCapabilityScenario.assertUnsupportedCallCapability([
      request.capability(request.expression),
      request.sourcePath,
      request.call,
    ]);
    const resolved = request.resolve(request.expression);
    if (resolved !== request.expression) {
      SkillProviderTypescriptCapabilityScenario.assertNestedCallArgument([
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
        if (ts.isPropertyAssignment(property))
          nested.push(property.initializer);
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
            SkillProviderTypescriptCapabilityScenario.inspectDeferredAggregateNode(
              [request, nextVisited, node],
            ),
          );
      }
    }
    for (const expression of nested)
      SkillProviderTypescriptCapabilityScenario.assertNestedCallArgument([
        { ...request, expression },
        nextVisited,
      ]);
  }

  static inspectDeferredAggregateNode([request, visited, node]: readonly [
    UnsupportedCallArgumentRequest,
    ReadonlySet<ts.Expression>,
    ts.Node,
  ]): void {
    if (ts.isExpression(node))
      SkillProviderTypescriptCapabilityScenario.assertNestedCallArgument([
        { ...request, expression: node },
        visited,
      ]);
    ts.forEachChild(node, (child) =>
      SkillProviderTypescriptCapabilityScenario.inspectDeferredAggregateNode([
        request,
        visited,
        child,
      ]),
    );
  }

  static dynamicImportCapability(
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

  static exactObjectProperty([object, name]: readonly [
    ts.ObjectLiteralExpression,
    string,
  ]): ts.Expression | false {
    const matches = object.properties.filter(
      (candidate) =>
        candidate.name &&
        (ts.isIdentifier(candidate.name) ||
          ts.isStringLiteral(candidate.name)) &&
        candidate.name.text === name,
    );
    const match = matches[0];
    if (matches.length !== 1 || !match) return false;
    if (ts.isPropertyAssignment(match)) return match.initializer;
    return ts.isShorthandPropertyAssignment(match) ? match.name : false;
  }

  static isStaticWorkerThreadsRequire(expression: ts.Expression): boolean {
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

  static serializeSubprocessCommand(
    command: SerializedSubprocessCommand,
  ): string {
    const [defaulted3 = ''] = [command.words[0]?.value];
    const source = command.shellSource
      ? defaulted3
      : command.words
          .map((word) => {
            const escaped = word.value.replaceAll("'", "'\\''");
            return word.dynamic ? `"\${DYNAMIC:-${escaped}}"` : `'${escaped}'`;
          })
          .join(' ');
    return command.cwd === false
      ? source
      : `cd ${SkillProviderTypescriptCapabilityScenario.shellQuote(command.cwd.value)} && ${source}`;
  }

  static subprocessCwd(
    request: SubprocessCwdRequest,
  ): TaggedTemplateText | false {
    const object =
      SkillProviderTypescriptCapabilityScenario.subprocessOptionsObject(
        request,
      );
    if (object === false) return false;
    SkillProviderTypescriptCapabilityScenario.assertSubprocessEnvironment([
      request,
      object,
    ]);
    const cwd = SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
      object,
      'cwd',
    ]);
    if (cwd === false) return false;
    const evaluated = request.evaluate(cwd);
    if (evaluated.dynamic && !request.allowDynamicCwd)
      throw new Error(
        `Dynamic TypeScript subprocess cwd is forbidden in ${request.sourcePath}.`,
      );
    return evaluated.dynamic ? false : evaluated;
  }

  static auditSubprocessEnvironment(request: SubprocessCwdRequest): void {
    const object =
      SkillProviderTypescriptCapabilityScenario.subprocessOptionsObject(
        request,
      );
    if (object !== false)
      SkillProviderTypescriptCapabilityScenario.assertSubprocessEnvironment([
        request,
        object,
      ]);
  }

  static subprocessOptionsObject(
    request: SubprocessCwdRequest,
  ): ts.ObjectLiteralExpression | false {
    const [args = []] = [request.call.arguments];
    const first = args[0];
    let options: ts.Expression | false = false;
    if (request.kind === SubprocessCallKind.Bun) {
      const [defaulted4 = false] = [args[1]];
      options =
        first && request.resolveObject(first) !== false ? first : defaulted4;
    } else if (request.kind === SubprocessCallKind.Exec) {
      const [defaulted5 = false] = [args[1]];
      options = defaulted5;
    } else if (request.kind === SubprocessCallKind.Worker) {
      const [defaulted6 = false] = [args[1]];
      options = defaulted6;
    } else if (
      request.kind === SubprocessCallKind.ExecFile ||
      request.kind === SubprocessCallKind.Fork ||
      request.kind === SubprocessCallKind.Spawn
    ) {
      const second = args[1];
      const [defaulted7 = false] = [args[2]];
      options =
        second && request.resolveObject(second) !== false ? second : defaulted7;
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
      throw new Error(
        'Spread TypeScript subprocess cwd options are forbidden.',
      );
    return object;
  }

  static assertSubprocessEnvironment([request, object]: readonly [
    SubprocessCwdRequest,
    ts.ObjectLiteralExpression,
  ]): void {
    if (
      object.properties.some(
        (property) => property.name && ts.isComputedPropertyName(property.name),
      )
    )
      throw new Error(
        'Dynamic TypeScript subprocess environment is forbidden.',
      );
    const environment =
      SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
        object,
        'env',
      ]);
    const environmentProperties = object.properties.filter(
      (property) =>
        property.name &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === 'env',
    );
    if (environment === false && environmentProperties.length > 0)
      throw new Error(
        'Dynamic TypeScript subprocess environment is forbidden.',
      );
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
        if (
          !SkillProviderTypescriptCapabilityScenario.isSafeSubprocessEnvironmentKey(
            property.name.text,
          )
        )
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
          !SkillProviderTypescriptCapabilityScenario.isPlatformPathEnvironmentValue(
            {
              value: property.initializer,
              name: pathEnvironmentKey,
            },
          )
        )
          throw new Error(
            `Unsafe TypeScript subprocess PATH value in ${request.sourcePath}.`,
          );
        if (
          pathEnvironmentKey === false &&
          !SkillProviderTypescriptCapabilityScenario.isSafeSubprocessEnvironmentValue(
            {
              name: property.name.text,
              value: property.initializer,
            },
          )
        )
          throw new Error(
            `Unsafe TypeScript subprocess environment value for ${property.name.text} in ${request.sourcePath}.`,
          );
        names.add(property.name.text);
      }
      SkillProviderTypescriptCapabilityScenario.assertGitSafeDirectoryEnvironment(
        { request, object, environment, names },
      );
    }
    const shell = SkillProviderTypescriptCapabilityScenario.exactObjectProperty(
      [object, 'shell'],
    );
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
    const execArgv =
      SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
        object,
        'execArgv',
      ]);
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
    const evaluate =
      SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
        object,
        'eval',
      ]);
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

  static isSafeSubprocessEnvironmentValue(
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
    if (
      name === 'GIT_CONFIG_COUNT' ||
      name === 'GIT_CONFIG_KEY_0' ||
      name === 'GIT_CONFIG_VALUE_0'
    )
      return true;
    if (name === 'GIT_AUTHOR_DATE' || name === 'GIT_COMMITTER_DATE')
      return (
        (ts.isStringLiteral(value) && /^@[0-9]+ \+0000$/u.test(value.text)) ||
        SkillProviderTypescriptCapabilityScenario.isNamedPropertyAccess({
          value,
          name: 'commitTimestamp',
        })
      );
    if (name === 'GIT_INDEX_FILE')
      return (
        ts.isStringLiteral(value) ||
        SkillProviderTypescriptCapabilityScenario.isNamedPropertyAccess({
          value,
          name: 'indexFile',
        })
      );
    return SkillProviderTypescriptCapabilityScenario.isProcessEnvironmentAccess(
      { value, name },
    );
  }

  static isNamedPropertyAccess(
    request: SafeSubprocessEnvironmentValueRequest,
  ): boolean {
    return (
      ts.isPropertyAccessExpression(request.value) &&
      request.value.name.text === request.name
    );
  }

  static isProcessEnvironmentAccess(
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

  static assertGitSafeDirectoryEnvironment(request: {
    readonly request: SubprocessCwdRequest;
    readonly object: ts.ObjectLiteralExpression;
    readonly environment: ts.ObjectLiteralExpression;
    readonly names: ReadonlySet<string>;
  }): void {
    const configNames = [
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
    ] as const;
    if (!configNames.some((name) => request.names.has(name))) return;
    const executable = request.request.call.arguments?.[0];
    const evaluated = executable
      ? request.request.evaluate(executable)
      : { dynamic: true, value: '' };
    const count = SkillProviderTypescriptCapabilityScenario.exactObjectProperty(
      [request.environment, 'GIT_CONFIG_COUNT'],
    );
    const key = SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
      request.environment,
      'GIT_CONFIG_KEY_0',
    ]);
    const value = SkillProviderTypescriptCapabilityScenario.exactObjectProperty(
      [request.environment, 'GIT_CONFIG_VALUE_0'],
    );
    const cwd = SkillProviderTypescriptCapabilityScenario.exactObjectProperty([
      request.object,
      'cwd',
    ]);
    const allowedNames = new Set([
      'PATH',
      'GIT_NO_REPLACE_OBJECTS',
      ...configNames,
    ]);
    if (
      evaluated.dynamic ||
      evaluated.value !== 'git' ||
      [...request.names].some((name) => !allowedNames.has(name)) ||
      !request.names.has('PATH') ||
      configNames.some((name) => !request.names.has(name)) ||
      count === false ||
      !ts.isStringLiteral(count) ||
      count.text !== '1' ||
      key === false ||
      !ts.isStringLiteral(key) ||
      key.text !== 'safe.directory' ||
      value === false ||
      cwd === false ||
      !SkillProviderTypescriptCapabilityScenario.isStableSafeDirectoryValue({
        value,
        cwd,
      })
    )
      throw new Error(
        `Unsafe TypeScript Git safe.directory environment in ${request.request.sourcePath}.`,
      );
  }

  static isStableSafeDirectoryValue(request: {
    readonly value: ts.Expression;
    readonly cwd: ts.Expression;
  }): boolean {
    const safeDirectory =
      SkillProviderTypescriptCapabilityScenario.unwrapTypescriptExpression(
        request.value,
      );
    const workingDirectory =
      SkillProviderTypescriptCapabilityScenario.unwrapTypescriptExpression(
        request.cwd,
      );
    if (ts.isIdentifier(safeDirectory) && ts.isIdentifier(workingDirectory))
      return safeDirectory.text === workingDirectory.text;
    const canonicalLiteral =
      ts.isStringLiteral(safeDirectory) &&
      (safeDirectory.text === '/' ||
        (safeDirectory.text.startsWith('/') &&
          !safeDirectory.text.endsWith('/') &&
          safeDirectory.text
            .split('/')
            .slice(1)
            .every(
              (segment) =>
                segment.length > 0 && segment !== '.' && segment !== '..',
            )));
    return (
      canonicalLiteral &&
      ts.isStringLiteral(workingDirectory) &&
      safeDirectory.text === workingDirectory.text
    );
  }

  static isPlatformPathEnvironmentValue(
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

  static isSafeSubprocessEnvironmentKey(name: string): boolean {
    return (
      name === 'COMSPEC' ||
      name === 'GIT_AUTHOR_DATE' ||
      name === 'GIT_COMMITTER_DATE' ||
      name === 'GIT_CONFIG_COUNT' ||
      name === 'GIT_CONFIG_GLOBAL' ||
      name === 'GIT_CONFIG_KEY_0' ||
      name === 'GIT_CONFIG_NOSYSTEM' ||
      name === 'GIT_CONFIG_VALUE_0' ||
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

  static subprocessArgumentList(
    request: SubprocessCwdRequest,
  ): ts.Expression | false {
    const second = request.call.arguments?.[1];
    if (!second) return false;
    return request.kind !== SubprocessCallKind.Exec &&
      request.resolveObject(second) !== false
      ? false
      : second;
  }

  static isSuccessorFreeExternalCommand(
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
    SkillProviderTypescriptCapabilityScenario.assertExternalCommandArguments([
      executable.value,
      command.words.slice(1),
    ]);
    return true;
  }

  static assertExternalCommandArguments([executable, words]: readonly [
    string,
    readonly TaggedTemplateText[],
  ]): void {
    const values = words.map((word) => (word.dynamic ? false : word.value));
    if (executable === 'git') {
      SkillProviderTypescriptCapabilityScenario.assertGitSubcommandArguments(
        values,
      );
      for (const [index, value] of values.entries()) {
        const next = values[index + 1];
        if (
          value === '-c' &&
          (!next ||
            SkillProviderTypescriptCapabilityScenario.gitConfigRunsCommand(
              next,
            ))
        )
          throw new Error('Command-capable git configuration is forbidden.');
        if (
          value &&
          value.startsWith('-c') &&
          SkillProviderTypescriptCapabilityScenario.gitConfigRunsCommand(
            value.slice(2),
          )
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

  static assertGitSubcommandArguments(
    values: readonly (string | false)[],
  ): void {
    const located =
      SkillProviderTypescriptCapabilityScenario.gitSubcommand(values);
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
        SkillProviderTypescriptCapabilityScenario.gitConfigKeyRunsCommand(
          value,
        ) &&
        argumentIndex + 1 < args.length
      )
        throw new Error('Command-capable git configuration is forbidden.');
    }
  }

  static gitSubcommand(
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

  static gitConfigRunsCommand(value: string): boolean {
    const separator = value.indexOf('=');
    if (separator < 1) return false;
    const key = value.slice(0, separator);
    const configured = value.slice(separator + 1).trimStart();
    return /^alias\./iu.test(key)
      ? configured.startsWith('!')
      : SkillProviderTypescriptCapabilityScenario.gitConfigKeyRunsCommand(key);
  }

  static gitConfigKeyRunsCommand(key: string): boolean {
    return /^(?:core\.sshcommand|diff\.external|difftool\..*\.cmd|filter\..*\.(?:clean|process|smudge)|mergetool\..*\.cmd)$/iu.test(
      key,
    );
  }

  static shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }
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
