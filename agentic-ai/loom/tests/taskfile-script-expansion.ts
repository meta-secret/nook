type TaskVariable = string | { readonly sh?: string };
type TaskVariableMatch = [string, string];
type TaskCommand = string | { readonly cmd?: string; readonly defer?: string };

type TaskDefinition = {
  readonly cmds?: readonly TaskCommand[];
  readonly vars?: Readonly<Record<string, TaskVariable>>;
};

type TaskVariableDocument = {
  readonly tasks?: Readonly<Record<string, TaskDefinition>>;
  readonly vars?: Readonly<Record<string, TaskVariable>>;
};

const TASK_PATH_TEMPLATE =
  /(?:bun|node|bash|sh)\s+["']?\{\{\.[A-Za-z_][A-Za-z0-9_]*\}\}|(?:^|[;&|]\s*)\{\{\.[A-Za-z_][A-Za-z0-9_]*\}\}(?=\s|$)/u;
const TASK_VARIABLE_TEMPLATE = /\{\{\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;
const REPOSITORY_ROOT_COMMAND =
  'if [ -n "${REPO_ROOT:-}" ]; then printf "%s" "$REPO_ROOT"; else git rev-parse --show-toplevel; fi';

export function expandStaticTaskVariables(source: string): string {
  const document = Bun.YAML.parse(source) as TaskVariableDocument;
  if (!document.tasks) return '';
  return Object.values(document.tasks)
    .flatMap((task) => {
      const variables = { ...document.vars, ...task.vars };
      return (task.cmds ?? []).flatMap((command) => {
        const value =
          typeof command === 'string'
            ? command
            : (command.cmd ?? command.defer);
        if (typeof value !== 'string') return [];
        let expansions = 0;
        let invalid = false;
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
            invalid ||= replacement !== undefined || stack.length > 0;
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
        if (invalid && TASK_PATH_TEMPLATE.test(expanded)) {
          throw new Error('Task launch variable is unresolved or dynamic');
        }
        return [expanded];
      });
    })
    .join('\n');
}
