type TaskDefinition = {
  readonly cmds?: readonly string[];
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
