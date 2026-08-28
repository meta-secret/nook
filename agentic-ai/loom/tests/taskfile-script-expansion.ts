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
  /&&|\|\||[;|\n]|[^\s;&|]*\{\{[^{}]+\}\}[^\s;&|]*|"(?:\\.|[^"])*"|'[^']*'|[^\s;&|]+/gu;
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
          source: expanded,
        };
        assertStaticTaskLaunch(launchRequest);
        return [expanded];
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
  readonly source: string;
};
function assertStaticTaskLaunch(request: StaticTaskLaunchRequest): void {
  const tokens = request.source
    .replace(/\\\r?\n/gu, ' ')
    .match(TASK_SHELL_TOKEN);
  const segments: string[][] = [[]];
  for (const token of tokens ?? []) {
    if (/^(?:&&|\|\||;|\||\n)$/u.test(token)) segments.push([]);
    else segments.at(-1)?.push(token);
  }
  for (const segment of segments) {
    const segmentRequest: TaskSegmentRequest = {
      launch: request,
      tokens: segment,
    };
    if (taskSegmentHasDynamicLaunch(segmentRequest)) {
      throw new Error('Task launch variable is unresolved or dynamic');
    }
  }
}
type TaskSegmentRequest = {
  readonly launch: StaticTaskLaunchRequest;
  readonly tokens: readonly string[];
};
function taskSegmentHasDynamicLaunch(request: TaskSegmentRequest): boolean {
  const { tokens } = request;
  const bindings = new Map<string, TaskVariable>(
    Object.entries(request.launch.environment),
  );
  const resolve = (token: string): string => {
    const value = unquote(token);
    const reference = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/u.exec(value)?.[1];
    if (!reference) return value;
    const binding = bindings.get(reference);
    return typeof binding === 'string' ? request.launch.expand(binding) : value;
  };
  let index = 0;
  while (index < tokens.length) {
    const assignment = taskAssignment(tokens[index] ?? '');
    if (assignment === false) break;
    bindings.set(assignment[0], assignment[1]);
    index += 1;
  }
  while (['command', 'exec', 'env'].includes(unquote(tokens[index] ?? ''))) {
    const wrapper = unquote(tokens[index] ?? '');
    index += 1;
    if (wrapper !== 'env') continue;
    while (index < tokens.length) {
      const assignment = taskAssignment(tokens[index] ?? '');
      if (assignment === false) break;
      bindings.set(assignment[0], assignment[1]);
      index += 1;
    }
  }
  const executable = resolve(tokens[index] ?? '');
  if (containsTaskTemplate(executable)) return true;
  if (unquote(executable) === 'cd') {
    return containsTaskTemplate(resolve(tokens[index + 1] ?? ''));
  }
  if (!TASK_INTERPRETERS.has(unquote(executable))) return false;
  index += 1;
  while (
    index < tokens.length &&
    unquote(tokens[index] ?? '').startsWith('-')
  ) {
    const option = resolve(tokens[index] ?? '');
    if (containsTaskTemplate(option)) return true;
    if (
      /^(?:bash|sh)$/u.test(unquote(executable)) &&
      unquote(option) === '-c'
    ) {
      const nestedRequest: StaticTaskLaunchRequest = {
        ...request.launch,
        source: unquote(tokens[index + 1] ?? ''),
      };
      assertStaticTaskLaunch(nestedRequest);
      return false;
    }
    if (unquote(option) === '--cwd') {
      index += 1;
      if (containsTaskTemplate(resolve(tokens[index] ?? ''))) return true;
    }
    index += 1;
  }
  return containsTaskTemplate(resolve(tokens[index] ?? ''));
}
function taskAssignment(
  token: string,
): readonly [string, TaskVariable] | false {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(token);
  return match?.[1] && typeof match[2] === 'string'
    ? [match[1], unquote(match[2])]
    : false;
}
function containsTaskTemplate(value: string): boolean {
  return /\{\{[^{}]+\}\}/u.test(value);
}
function unquote(value: string): string {
  return /^(?:"[\s\S]*"|'[\s\S]*')$/u.test(value) ? value.slice(1, -1) : value;
}
