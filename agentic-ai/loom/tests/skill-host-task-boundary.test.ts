import { expect, test } from 'bun:test';
import {
  CANONICAL_TASKFILE,
  CANONICAL_TASK_SOURCE,
  hasCanonicalToolsListTask,
  hasExactToolsListTaskGraph,
  HOST_CLI,
  TASK_YAML_BYTE_LIMIT,
} from './skill-host-task-boundary.ts';

type Source = { readonly path: string; readonly source: string };
const ROOT_SOURCE =
  "version: '3'\nincludes: {agentic-ai: {taskfile: .task/agentic-ai.yml, flatten: true}}\ntasks: {safe: {cmds: [echo safe]}}\n";
const AGENTIC_SOURCE =
  "version: '3'\nincludes: {executable-skill-host: {taskfile: executable-skill-host.yml, flatten: true}}\ntasks: {safe: {cmds: [echo safe]}}\n";
const EMPTY_SOURCES: readonly Source[] = [];

function graph(provided?: readonly Source[]): readonly Source[] {
  const extras = provided ?? EMPTY_SOURCES;
  return [
    { path: 'Taskfile.yml', source: ROOT_SOURCE },
    { path: '.task/agentic-ai.yml', source: AGENTIC_SOURCE },
    { path: CANONICAL_TASKFILE, source: CANONICAL_TASK_SOURCE },
    ...extras,
  ];
}

test('accepts only the exact finite public tools-list Task schema', () => {
  expect(hasCanonicalToolsListTask(CANONICAL_TASK_SOURCE)).toBe(true);
  for (const source of [
    CANONICAL_TASK_SOURCE.replace('silent: true', 'silent: false'),
  ])
    expect(hasCanonicalToolsListTask(source), source).toBe(false);
});

test('requires one exact flattened include chain', () => {
  expect(hasExactToolsListTaskGraph(graph())).toBe(true);
  expect(
    hasExactToolsListTaskGraph(
      graph([
        {
          path: '.task/agentic-ai.yml',
          source: AGENTIC_SOURCE.replace('flatten: true', 'flatten: false'),
        },
      ]),
    ),
  ).toBe(false);
  for (const source of [
    'includes: {executable-skill-host: {taskfile: executable-skill-host.yml, flatten: true}}',
    'includes:\n  executable-skill-host: {}\n  executable-skill-host: {}\n',
  ]) {
    const path = '.task/nested/alternate.yml';
    expect(hasExactToolsListTaskGraph(graph([{ path, source }]))).toBe(false);
  }
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
  for (const [index, source] of hazards.entries()) {
    expect(
      hasExactToolsListTaskGraph(
        graph([{ path: `.task/hazard-${index}.yml`, source }]),
      ),
    ).toBe(false);
  }
});

test('rejects every proven alternate repository Task declaration', () => {
  const root = HOST_CLI.slice(0, -7);
  const cases = [
    `cmds: [bun "${HOST_CLI.replace('executable-skill-host', 'execut?ble-skill-hos?')}"]`,
    `cmds: [bun "${HOST_CLI.replace('executable-skill-host', 'execut"able-skill-"host')}"]`,
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
    'vars: {FAMILY: skills, ACTION: tools-list}\n    cmds: [{task: "{{.FAMILY}}:{{.ACTION}}"}]',
  ];
  for (const [index, body] of cases.entries()) {
    const source = `tasks:\n  alternate:\n    ${body}\n`;
    expect(
      hasExactToolsListTaskGraph(
        graph([{ path: `.task/nested/${index}.yml`, source }]),
      ),
    ).toBe(false);
  }
});

test('does not claim to prevent ordinary same-user shell execution', () => {
  const ordinary: Source = {
    path: '.task/ordinary.yml',
    source: 'tasks: {ordinary: {cmds: [echo "$LABEL"]}}\n',
  };
  expect(hasExactToolsListTaskGraph(graph([ordinary]))).toBe(true);
});
