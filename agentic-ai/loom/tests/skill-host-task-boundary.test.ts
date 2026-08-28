import { expect, test } from 'bun:test';
import {
  AGENTIC_AI_TASKFILE,
  CANONICAL_TASKFILE,
  CANONICAL_TASK_SOURCE,
  hasCanonicalToolsListTask,
  hasExactToolsListTaskGraph,
  hasOnlyCanonicalHostTaskEdge,
  HOST_CLI,
  ROOT_TASKFILE,
} from './skill-host-task-boundary.ts';

const ROOT_SOURCE = `version: '3'
includes:
  agentic-ai:
    taskfile: .task/agentic-ai.yml
    flatten: true
tasks:
  safe:
    cmds: [echo safe]
`;

const AGENTIC_SOURCE = `version: '3'
includes:
  executable-skill-host:
    taskfile: executable-skill-host.yml
    flatten: true
tasks:
  safe:
    cmds: [echo safe]
`;

function canonicalGraph(
  providedExtras?: readonly {
    readonly path: string;
    readonly source: string;
  }[],
): readonly { readonly path: string; readonly source: string }[] {
  const extras = providedExtras ?? [];
  return [
    { path: ROOT_TASKFILE, source: ROOT_SOURCE },
    { path: AGENTIC_AI_TASKFILE, source: AGENTIC_SOURCE },
    { path: CANONICAL_TASKFILE, source: CANONICAL_TASK_SOURCE },
    ...extras,
  ];
}

test('accepts only the exact finite public tools-list Task schema', () => {
  expect(hasCanonicalToolsListTask(CANONICAL_TASK_SOURCE)).toBe(true);
  expect(hasOnlyCanonicalHostTaskEdge(CANONICAL_TASK_SOURCE)).toBe(true);
  for (const source of [
    CANONICAL_TASK_SOURCE.replace('silent: true', 'silent: false'),
    CANONICAL_TASK_SOURCE.replace('skills:install', 'loom:install'),
    CANONICAL_TASK_SOURCE.replace(
      '  skills:tools-list:',
      '  skills:tools-list:\n    aliases: [tools-list]',
    ),
    CANONICAL_TASK_SOURCE.replace(
      '    cmds:\n      - bun',
      '    dir: .\n    cmds:\n      - bun',
    ),
    CANONICAL_TASK_SOURCE.replace(
      '    cmds:\n      - bun',
      '    preconditions: [test -f marker]\n    cmds:\n      - bun',
    ),
    CANONICAL_TASK_SOURCE.replace(
      '    cmds:\n      - bun',
      '    status: [test -f marker]\n    cmds:\n      - bun',
    ),
    `${CANONICAL_TASK_SOURCE}\ntasks: {extra: {cmds: [echo extra]}}\n`,
  ]) {
    expect(hasCanonicalToolsListTask(source), source).toBe(false);
    expect(hasOnlyCanonicalHostTaskEdge(source), source).toBe(false);
  }
});

test('accepts exactly one flattened include chain to the canonical task', () => {
  expect(hasExactToolsListTaskGraph(canonicalGraph())).toBe(true);
  expect(
    hasExactToolsListTaskGraph(
      canonicalGraph([
        {
          path: '.task/duplicate.yml',
          source:
            'includes:\n  executable-skill-host:\n    taskfile: executable-skill-host.yml\n    flatten: true\n',
        },
      ]),
    ),
  ).toBe(false);
  expect(
    hasExactToolsListTaskGraph(
      canonicalGraph().map((entry) =>
        entry.path === AGENTIC_AI_TASKFILE
          ? { ...entry, source: entry.source.replace('true', 'false') }
          : entry,
      ),
    ),
  ).toBe(false);
});

test('rejects every alternate declarative Task execution surface', () => {
  const alternateSources = [
    `tasks:\n  alternate:\n    cmds: [bun "${HOST_CLI.replace('cli.ts', '?li.ts')}"]`,
    `tasks:\n  alternate:\n    cmds: [cd "${HOST_CLI.slice(0, -7)}" && bun cli.ts]`,
    `tasks:\n  alternate:\n    cmds: [bun --cwd "${HOST_CLI.slice(0, -7)}" cli.ts]`,
    'tasks:\n  alternate:\n    cmds: [task --dir . skills:tools-list]',
    `tasks:\n  alternate:\n    cmds:\n      - |\n        ENTRY=${HOST_CLI.slice(0, -6)}\\\n        cli.ts\n        bun "$ENTRY"`,
    'tasks:\n  alternate:\n    deps: [skills:tools-list]\n    cmds: [echo bypass]',
    'tasks:\n  alternate:\n    cmds:\n      - task: skills:tools-list',
    'tasks:\n  alternate:\n    aliases: [skills:tools-list]\n    cmds: [echo bypass]',
    'vars:\n  ENTRY:\n    sh: printf executable-skill-host\ntasks: {}',
    'tasks:\n  alternate:\n    preconditions: [task skills:tools-list]\n    cmds: [echo bypass]',
    'tasks:\n  alternate:\n    status: [go-task skills:tools-list]\n    cmds: [echo bypass]',
    `tasks:\n  alternate:\n    dir: ${HOST_CLI.slice(0, -7)}\n    cmds: [bun cli.ts]`,
  ];
  for (const [index, source] of alternateSources.entries()) {
    expect(
      hasExactToolsListTaskGraph(
        canonicalGraph([{ path: `.task/alternate-${index}.yml`, source }]),
      ),
      source,
    ).toBe(false);
  }
});

test('does not claim to prevent ordinary same-user shell execution', () => {
  expect(
    hasExactToolsListTaskGraph(
      canonicalGraph([
        {
          path: '.task/ordinary.yml',
          source: 'tasks:\n  ordinary:\n    cmds: [echo "$LABEL"]\n',
        },
      ]),
    ),
  ).toBe(true);
});
