import { posix } from 'node:path';

type TaskCommand = string | { readonly cmd?: string; readonly defer?: string };
type TaskDefinition = {
  readonly cmds?: readonly TaskCommand[];
  readonly deps?: readonly string[];
  readonly desc?: string;
  readonly silent?: boolean;
};

type TaskDocument = {
  readonly tasks?: Readonly<Record<string, TaskDefinition>>;
};

export const HOST_ROOT =
  '.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src/';
export const HOST_CLI = `${HOST_ROOT}cli.ts`;
export const HOST_TOOLS_LIST_SOURCE_PATHS = [
  HOST_CLI,
  ...'skill-action-registry skill-cli-invocation skill-command-domain skill-command-path skill-yaml-codec'
    .split(' ')
    .map((name) => `${HOST_ROOT}${name}.ts`),
];
export const CANONICAL_TASKFILE = '.task/agentic-ai.yml';
export const HOST_CLI_TEMPLATE = `{{.REPO_ROOT}}/${HOST_CLI}`;
export const TOOLS_LIST_COMMAND = `bun "${HOST_CLI_TEMPLATE}" --default toolsList`;
const TASK_PATH_REFERENCE =
  /(?:\{\{\s*\.REPO_ROOT\s*\}\}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/gu;

export function hasCanonicalToolsListTask(source: string): boolean {
  const document = Bun.YAML.parse(source) as TaskDocument;
  const task = document.tasks?.['skills:tools-list'];
  return (
    task?.desc === 'List executable skill actions through strict YAML.' &&
    JSON.stringify(Object.keys(task).sort()) ===
      '["cmds","deps","desc","silent"]' &&
    task.silent === true &&
    JSON.stringify(task.deps) === '["skills:install"]' &&
    JSON.stringify(task.cmds) === JSON.stringify([TOOLS_LIST_COMMAND]) &&
    source.split(HOST_CLI_TEMPLATE).length === 2
  );
}

export function hasOnlyCanonicalHostTaskEdge(source: string): boolean {
  if (!hasCanonicalToolsListTask(source)) return false;
  const document = Bun.YAML.parse(source) as TaskDocument;
  const tasks = document.tasks;
  if (!tasks) return false;
  const hostEdges: Array<readonly [string, string]> = [];
  for (const [taskName, task] of Object.entries(tasks)) {
    for (const command of task.cmds ?? []) {
      const value =
        typeof command === 'string' ? command : (command.cmd ?? command.defer);
      if (typeof value !== 'string') continue;
      const withoutRoot = value.replace(/\{\{\s*\.REPO_ROOT\s*\}\}\//gu, '');
      for (const match of withoutRoot.matchAll(TASK_PATH_REFERENCE)) {
        const paths = [
          posix.normalize(match[0]),
          posix.normalize(
            posix.join(posix.dirname(CANONICAL_TASKFILE), match[0]),
          ),
        ];
        const hostPath = paths.find((path) => path.startsWith(HOST_ROOT));
        if (hostPath) hostEdges.push([taskName, hostPath]);
      }
    }
  }
  return (
    hostEdges.length === 1 &&
    hostEdges[0]?.[0] === 'skills:tools-list' &&
    hostEdges[0]?.[1] === HOST_CLI
  );
}
