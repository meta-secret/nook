import { posix } from 'node:path';
type TaskVariable = string | { readonly sh?: string };
type TaskVariableMatch = [string, string];
type TaskCommand = string | { readonly cmd?: string; readonly defer?: string };
type TaskDefinition = {
  readonly cmds?: readonly TaskCommand[];
  readonly vars?: Readonly<Record<string, TaskVariable>>;
};
type TaskVariableDocument = {
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
const TASK_PATH_TEMPLATE =
  /(?:bun|node|bash|sh)\s+["']?[^\s"']*\{\{\.[A-Za-z_][A-Za-z0-9_]*\}\}[^\s"']*|(?:^|[;&|]\s*)(?![A-Za-z_][A-Za-z0-9_]*=)[^\s;&|]*\{\{\.[A-Za-z_][A-Za-z0-9_]*\}\}[^\s;&|]*(?=\s|$)/u;
const TASK_VARIABLE_TEMPLATE = /\{\{\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;
const REPOSITORY_ROOT_COMMAND =
  'if [ -n "${REPO_ROOT:-}" ]; then printf "%s" "$REPO_ROOT"; else git rev-parse --show-toplevel; fi';
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
      if (!/(^|\/)Taskfile\.ya?ml$/u.test(candidate)) continue;
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
          text.replace(TASK_VARIABLE_TEMPLATE, replaceVariable);
        const expanded = expand(value);
        if (TASK_PATH_TEMPLATE.test(expanded)) {
          throw new Error('Task launch variable is unresolved or dynamic');
        }
        return [expanded];
      });
    })
    .join('\n');
}
