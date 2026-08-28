import { expect, test } from 'bun:test';
import {
  CANONICAL_TASKFILE,
  CANONICAL_TASK_SOURCE,
  hasExactToolsListTaskGraph,
  HOST_CLI,
  TASK_YAML_BYTE_LIMIT,
} from './skill-host-task-boundary.ts';
type Source = { readonly path: string; readonly source: string };
const REPOSITORY_ROOT = `${import.meta.dir}/../../..`;
const ROOT_SOURCE = await Bun.file(`${REPOSITORY_ROOT}/Taskfile.yml`).text();
const AGENTIC_SOURCE = await Bun.file(
  `${REPOSITORY_ROOT}/.task/agentic-ai.yml`,
).text();
function graph(provided?: readonly Source[]): readonly Source[] {
  return [
    { path: 'Taskfile.yml', source: ROOT_SOURCE },
    { path: '.task/agentic-ai.yml', source: AGENTIC_SOURCE },
    { path: CANONICAL_TASKFILE, source: CANONICAL_TASK_SOURCE },
    ...(provided ?? []),
  ];
}
function bad([path, source]: readonly [string, string]): void {
  expect(hasExactToolsListTaskGraph(graph([{ path, source }]))).toBe(false);
}
test('requires one exact flattened include chain', () => {
  expect(hasExactToolsListTaskGraph(graph())).toBe(true);
  bad([CANONICAL_TASKFILE, CANONICAL_TASK_SOURCE.replace('true', 'false')]);
  bad([
    '.task/agentic-ai.yml',
    AGENTIC_SOURCE.replace('flatten: true', 'flatten: false'),
  ]);
  bad([
    '.task/nested/alternate.yml',
    'includes: {executable-skill-host: {taskfile: executable-skill-host.yml, flatten: true}}',
  ]);
  bad([
    '.task/nested/alternate.yml',
    'includes:\n  executable-skill-host: {}\n  executable-skill-host: {}\n',
  ]);
});
test('rejects strict YAML hazards before conversion', () => {
  const hazards = [
    '%YAML 1.2\n---\nsafe: true\n',
    'safe: !!str value\n',
    'safe: &value true\ncopy: *value\n',
    'safe: true\nsafe: false\n',
    'safe: |\n  ' + 'x'.repeat(16_385),
    `${'nested:\n '.repeat(65)}value: true\n`,
    `values: [${'true,'.repeat(65_537)}false]\n`,
    '#'.repeat(TASK_YAML_BYTE_LIMIT + 1),
  ];
  for (const [index, source] of hazards.entries())
    bad([`.task/hazard-${index}.yml`, source]);
});
test('rejects every proven alternate repository Task declaration', () => {
  const root = HOST_CLI.slice(0, -7);
  const cases = [
    `cmds: [bun "${HOST_CLI.replace('executable-skill-host', 'execut?ble-skill-hos?')}"]`,
    `cmds: [cd "${root}" && bun cli.ts]`,
    `cmds: [bun --cwd "${root}" cli.ts]`,
    'cmds: [task --dir . skills:tools-list]',
    `cmds: ["ENTRY=${root}\\\ncli.ts; bun $ENTRY"]`,
    'deps: [skills:tools-list]\n    cmds: [echo bypass]',
    'cmds: [{task: skills:tools-list}]',
    'aliases: [skills:tools-list]\n    cmds: [echo bypass]',
    'vars: {ENTRY: {sh: printf executable-skill-host}}\n    cmds: [echo bypass]',
    'preconditions: [task skills:tools-list]\n    cmds: [echo bypass]',
    'status: [go-task skills:tools-list]\n    cmds: [echo bypass]',
    `dir: ${root}\n    cmds: [bun cli.ts]`,
    'cmds: [task skills:tools-$(printf list)]',
    'cmds: [go-task skills:tools-$(printf list)]',
    'vars: {PREFIX: skills:tools-, SUFFIX: list}\n    cmds: [{task: "{{.PREFIX}}{{.SUFFIX}}"}]',
    'vars: {A: executable, B: skill, C: host}\n    cmds: [bun dynamic-skills/$A-$B-$C/scripts/src/cli.ts --default toolsList]',
    'vars: {PREFIX: "skills:tools-", SUFFIX: "list"}\n    cmds: [{task: "{{.PREFIX}}{{.SUFFIX}}"}]',
  ];
  for (const [index, body] of cases.entries()) {
    const source = `tasks:\n  alternate:\n    ${body}\n`;
    bad([`.task/nested/${index}.yml`, source]);
  }
});
