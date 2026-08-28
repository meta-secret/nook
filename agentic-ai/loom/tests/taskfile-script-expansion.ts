import { posix } from 'node:path';
type TaskVariable = string | { readonly sh?: string };
type TaskVariableMatch = [string, string];
type TaskCommand = string | { readonly cmd?: string; readonly defer?: string };
type TaskDefinition = {
  readonly cmds?: readonly TaskCommand[];
  readonly env?: Readonly<Record<string, TaskVariable>>;
  readonly vars?: Readonly<Record<string, TaskVariable>>;
};
type TaskVariableDocument = {
  readonly env?: Readonly<Record<string, TaskVariable>>;
  readonly includes?: Readonly<
    Record<string, string | { readonly taskfile?: string }>
  >;
  readonly tasks?: Readonly<Record<string, TaskDefinition>>;
  readonly vars?: Readonly<Record<string, TaskVariable>>;
};
type TaskExpansionRequest = {
  readonly importer: string;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};
const TASK_VARIABLE_TEMPLATE = /\{\{\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;
const TASK_DEFAULT_TEMPLATE =
  /\{\{\s*(?:default\s+"([^"]*)"\s+\.[A-Za-z_][A-Za-z0-9_]*|\.[A-Za-z_][A-Za-z0-9_]*\s*\|\s*default\s+"([^"]*)")\s*\}\}/gu;
const TASK_SHELL_TOKEN =
  /&&|\|\||[;&|\n]|(?:\{\{[^{}]+\}\}|\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)|"(?:\\.|[^"])*"|'[^']*'|[^\s;&|$"'{}]+)+/gu;
const SHELL_VARIABLE =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/gu;
const DYNAMIC_SHELL_VARIABLE =
  /\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/u;
const TASK_INTERPRETERS = new Set(['bash', 'bun', 'node', 'sh']);
const REPOSITORY_ROOT_COMMAND =
  'if [ -n "${REPO_ROOT:-}" ]; then printf "%s" "$REPO_ROOT"; else git rev-parse --show-toplevel; fi';
export function isTaskConfigurationPath(path: string): boolean {
  return (
    /(^|\/)Taskfile[^/]*\.ya?ml$/u.test(path) ||
    /^\.task\/(?:[^/]+\/)*[^/]+\.ya?ml$/u.test(path)
  );
}
export function expandStaticTaskVariables(
  request: TaskExpansionRequest,
): string {
  const document = Bun.YAML.parse(request.source) as TaskVariableDocument;
  const inherited: Record<string, TaskVariable> = {};
  const visited = new Set<string>();
  const inherit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const [candidate, source] of request.sources) {
      if (!isTaskConfigurationPath(candidate)) continue;
      const parent = Bun.YAML.parse(source) as TaskVariableDocument;
      if (!parent.includes) continue;
      for (const include of Object.values(parent.includes)) {
        const taskfile =
          typeof include === 'string' ? include : include.taskfile;
        if (
          typeof taskfile !== 'string' ||
          posix.normalize(posix.join(posix.dirname(candidate), taskfile)) !==
            path
        ) {
          continue;
        }
        inherit(candidate);
        Object.assign(inherited, parent.vars);
      }
    }
  };
  inherit(request.importer);
  if (!document.tasks) return '';
  return Object.values(document.tasks)
    .flatMap((task) => {
      const variables = { ...inherited, ...document.vars, ...task.vars };
      const environment = { ...document.env, ...task.env };
      return (task.cmds ?? []).flatMap((command) => {
        const value =
          typeof command === 'string'
            ? command
            : (command.cmd ?? command.defer);
        if (typeof value !== 'string') return [];
        let expansions = 0;
        const stack: string[] = [];
        let expand: (text: string) => string;
        const replaceVariable = (...match: TaskVariableMatch): string => {
          const [template, name] = match;
          const replacement = variables[name];
          if (
            /^(?:ROOT_DIR|TASKFILE_DIR)$/u.test(name) ||
            (name === 'REPO_ROOT' &&
              typeof replacement !== 'string' &&
              replacement?.sh === REPOSITORY_ROOT_COMMAND)
          ) {
            return '.';
          }
          if (
            typeof replacement !== 'string' &&
            typeof replacement?.sh === 'string'
          ) {
            const shell = expand(replacement.sh);
            const directory = /^cd\s+["']([^"']+)["']\s+&&\s+pwd$/u.exec(
              shell,
            )?.[1];
            if (directory && !containsLaunchVariable(directory))
              return directory;
          }
          if (
            typeof replacement !== 'string' ||
            stack.includes(name) ||
            expansions++ >= 64
          ) {
            return template.replace(/\s/gu, '');
          }
          stack.push(name);
          const result = expand(replacement);
          stack.pop();
          return result;
        };
        expand = (text) =>
          replaceStaticTaskDefaults(
            text.replace(TASK_VARIABLE_TEMPLATE, replaceVariable),
          );
        const expanded = expand(value);
        const launchRequest: StaticTaskLaunchRequest = {
          environment,
          expand,
          references: [],
          source: expanded,
        };
        assertStaticTaskLaunch(launchRequest);
        return [expanded, ...launchRequest.references];
      });
    })
    .join('\n');
}
function replaceStaticTaskDefaults(text: string): string {
  let expanded = text;
  for (const match of text.matchAll(TASK_DEFAULT_TEMPLATE)) {
    expanded = expanded.replace(match[0], match[1] ?? match[2] ?? '');
  }
  return expanded;
}
type StaticTaskLaunchRequest = {
  readonly environment: Readonly<Record<string, TaskVariable>>;
  readonly expand: (text: string) => string;
  readonly references: string[];
  readonly source: string;
};
function assertStaticTaskLaunch(request: StaticTaskLaunchRequest): void {
  const tokens = request.source
    .replace(/\\\r?\n/gu, ' ')
    .match(TASK_SHELL_TOKEN);
  const segments: string[][] = [[]];
  const bindings = new Map<string, TaskVariable>(
    Object.entries(request.environment),
  );
  for (const token of tokens ?? []) {
    if (/^(?:&&|\|\||;|&|\||\n)$/u.test(token)) segments.push([]);
    else segments.at(-1)?.push(token);
  }
  for (const segment of segments) {
    const segmentRequest: TaskSegmentRequest = {
      bindings,
      launch: request,
      tokens: segment,
    };
    if (taskSegmentHasDynamicLaunch(segmentRequest)) {
      throw new Error('Task launch variable is unresolved or dynamic');
    }
  }
}
type TaskSegmentRequest = {
  readonly bindings: TaskBindings;
  readonly launch: StaticTaskLaunchRequest;
  readonly tokens: readonly string[];
};
type TaskBindings = Map<string, TaskVariable>;
function taskSegmentHasDynamicLaunch(request: TaskSegmentRequest): boolean {
  const { tokens } = request;
  const shellBindings = request.bindings;
  const childBindings = new Map(shellBindings);
  const resolving = new Set<string>();
  let resolutions = 0;
  const resolve = (token: string): string => {
    let value = unquote(token);
    if (token.startsWith("'")) return value;
    for (const match of value.matchAll(SHELL_VARIABLE)) {
      const reference = match[1] ?? match[2];
      if (!reference || resolving.has(reference) || resolutions++ >= 64)
        continue;
      const binding = shellBindings.get(reference);
      if (typeof binding !== 'string') continue;
      resolving.add(reference);
      const replacement = resolve(request.launch.expand(binding));
      resolving.delete(reference);
      value = value.replace(match[0], replacement);
    }
    return value;
  };
  let index = 0;
  const prefixAssignments: Array<readonly [string, TaskVariable]> = [];
  while (index < tokens.length) {
    const assignment = taskAssignment(tokens[index] ?? '');
    if (assignment === false) break;
    prefixAssignments.push(assignment);
    childBindings.set(assignment[0], assignment[1]);
    index += 1;
  }
  if (index >= tokens.length) {
    for (const [name, value] of prefixAssignments)
      shellBindings.set(name, value);
    return false;
  }
  while (['command', 'exec', 'env'].includes(unquote(tokens[index] ?? ''))) {
    const wrapper = unquote(tokens[index] ?? '');
    index += 1;
    if (wrapper !== 'env') continue;
    while (index < tokens.length) {
      const assignment = taskAssignment(tokens[index] ?? '');
      if (assignment !== false) {
        childBindings.set(assignment[0], assignment[1]);
        index += 1;
        continue;
      }
      const option = unquote(tokens[index] ?? '');
      if (option === '--') {
        index += 1;
        break;
      }
      if (!option.startsWith('-')) break;
      index += 1;
      if (/^(?:-i|--ignore-environment)$/u.test(option)) childBindings.clear();
      if (/^(?:-u|--unset|-C|--chdir|-S|--split-string)$/u.test(option)) {
        const operand = resolve(tokens[index] ?? '');
        if (/^(?:-u|--unset)$/u.test(option)) childBindings.delete(operand);
        if (
          /^(?:-C|--chdir)$/u.test(option) &&
          containsLaunchVariable(operand)
        ) {
          return true;
        }
        if (/^(?:-S|--split-string)$/u.test(option)) {
          const splitRequest: StaticTaskLaunchRequest = {
            ...request.launch,
            environment: taskEnvironment(childBindings),
            source: operand,
          };
          assertStaticTaskLaunch(splitRequest);
        }
        index += 1;
      } else if (
        /^--chdir=/u.test(option) &&
        containsLaunchVariable(resolve(option))
      ) {
        return true;
      } else if (/^--unset=/u.test(option)) {
        childBindings.delete(option.slice(option.indexOf('=') + 1));
      } else if (/^--split-string=/u.test(option)) {
        const splitRequest: StaticTaskLaunchRequest = {
          ...request.launch,
          environment: taskEnvironment(childBindings),
          source: resolve(option.slice(option.indexOf('=') + 1)),
        };
        assertStaticTaskLaunch(splitRequest);
      }
    }
  }
  const executable = resolve(tokens[index] ?? '');
  if (containsLaunchVariable(executable)) return true;
  if (unquote(executable) === 'cd') {
    return containsLaunchVariable(resolve(tokens[index + 1] ?? ''));
  }
  if (!TASK_INTERPRETERS.has(unquote(executable))) {
    request.launch.references.push(executable);
    return false;
  }
  index += 1;
  if (
    /^(?:bash|sh)$/u.test(unquote(executable)) &&
    unquote(tokens[index] ?? '').startsWith('<<')
  ) {
    for (const [name, value] of childBindings) shellBindings.set(name, value);
  }
  while (
    index < tokens.length &&
    unquote(tokens[index] ?? '').startsWith('-')
  ) {
    const option = resolve(tokens[index] ?? '');
    if (containsLaunchVariable(option)) return true;
    if (
      /^(?:bash|sh)$/u.test(unquote(executable)) &&
      unquote(option) === '-c'
    ) {
      const nestedRequest: StaticTaskLaunchRequest = {
        ...request.launch,
        environment: taskEnvironment(childBindings),
        source: unquote(tokens[index + 1] ?? ''),
      };
      assertStaticTaskLaunch(nestedRequest);
      return false;
    }
    if (unquote(option) === '--cwd') {
      index += 1;
      if (containsLaunchVariable(resolve(tokens[index] ?? ''))) return true;
    }
    index += 1;
  }
  if (unquote(executable) === 'bun' && unquote(tokens[index] ?? '') === 'run') {
    index += 1;
    while (unquote(tokens[index] ?? '').startsWith('-')) {
      const option = unquote(tokens[index] ?? '');
      index += 1;
      if (/^(?:--cwd|--env-file|--filter|--shell)$/u.test(option)) index += 1;
    }
  }
  const target = resolve(tokens[index] ?? '');
  if (containsLaunchVariable(target)) return true;
  request.launch.references.push(target);
  return false;
}
function taskEnvironment(bindings: TaskBindings): Record<string, TaskVariable> {
  return Object.fromEntries(bindings);
}
function taskAssignment(
  token: string,
): readonly [string, TaskVariable] | false {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/u.exec(token);
  return match?.[1] && typeof match[2] === 'string'
    ? [match[1], unquote(match[2])]
    : false;
}
function containsLaunchVariable(value: string): boolean {
  return /\{\{[^{}]+\}\}/u.test(value) || DYNAMIC_SHELL_VARIABLE.test(value);
}
function unquote(value: string): string {
  return /^(?:"[\s\S]*"|'[\s\S]*')$/u.test(value) ? value.slice(1, -1) : value;
}
