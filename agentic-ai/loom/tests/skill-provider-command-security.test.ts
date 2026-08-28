import { expect, test } from 'bun:test';
import {
  actionRuntimePaths,
  configurationScriptPaths,
} from './skill-provider-config-boundary.test.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';
import type { ActionRuntimeGraph } from './skill-provider-config-types.ts';

const PROTECTED =
  '.cortex/teams/ai/dynamic-skills/example-skill/scripts/src/cli.ts';
const WRAPPER = '.github/scripts/with-healthy-buildkit.sh';

enum SourceOperator {
  Dot = '.',
  Source = 'source',
}
type SourcedGraphRequest = {
  readonly child: string;
  readonly operator: SourceOperator;
};

function sourcedGraph(request: SourcedGraphRequest): ConfigurationScriptGraph {
  return {
    executablePaths: new Set(),
    roots: ['Taskfile.yml'],
    sources: new Map([
      [
        'Taskfile.yml',
        `tasks: {audit: {cmds: [${request.operator} scripts/mutate.sh, bash ${WRAPPER}]}}`,
      ],
      ['scripts/mutate.sh', request.child],
      [WRAPPER, 'docker_bin="${DOCKER:-docker}"; "$docker_bin" buildx version'],
    ]),
    symlinkPaths: new Set(),
  };
}

function directGraph(command: string): ConfigurationScriptGraph {
  const root =
    command === '. /etc/os-release'
      ? 'infra/tasks/providers.yml'
      : 'Taskfile.yml';
  return {
    executablePaths: new Set(),
    roots: [root],
    sources: new Map([
      [root, `tasks: {audit: {cmds: [${command}]}}`],
      [WRAPPER, 'docker_bin="${DOCKER:-docker}"; "$docker_bin" buildx version'],
    ]),
    symlinkPaths: new Set(),
  };
}

test('rejects every sourced parent-shell Docker provenance mutation', () => {
  const mutations = [
    `declare -x DOCKER=${PROTECTED}`,
    `typeset -gx DOCKER=${PROTECTED}`,
    `export DOCKER=${PROTECTED}`,
    `printf -v DOCKER %s ${PROTECTED}`,
    `read DOCKER <<< ${PROTECTED}`,
    `declare -n ref=DOCKER; ref=${PROTECTED}`,
    `DOCKER+=${PROTECTED}`,
    `DOCKER[0]=${PROTECTED}`,
    `mapfile -t DOCKER <<< ${PROTECTED}`,
    `readarray DOCKER <<< ${PROTECTED}`,
    `declare +x DOCKER=${PROTECTED}`,
  ];
  for (const operator of [SourceOperator.Source, SourceOperator.Dot])
    for (const mutation of mutations) {
      const request: SourcedGraphRequest = { child: mutation, operator };
      expect(() => configurationScriptPaths(sourcedGraph(request))).toThrow();
    }
});

test('rejects interspersed redirection mutation and unaudited sources', () => {
  for (const command of [
    `> /tmp/out DOCKER=${PROTECTED}; bash ${WRAPPER}`,
    `declare > /tmp/out +x DOCKER=${PROTECTED}; bash ${WRAPPER}`,
    `read <<< ${PROTECTED} DOCKER; bash ${WRAPPER}`,
    `mapfile <<< ${PROTECTED} DOCKER; bash ${WRAPPER}`,
    `readarray <<< ${PROTECTED} DOCKER; bash ${WRAPPER}`,
  ])
    expect(() => configurationScriptPaths(directGraph(command))).toThrow();
  expect(configurationScriptPaths(directGraph('. /etc/os-release'))).toEqual(
    [],
  );
  for (const command of ['source scripts/other.sh', '. "$DYNAMIC"'])
    expect(() => configurationScriptPaths(directGraph(command))).toThrow();
});

test('pins the sole repository source helper', () => {
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['agentic-ai/minds/hive/Taskfile.yml'],
    sources: new Map([
      [
        'agentic-ai/minds/hive/Taskfile.yml',
        'tasks: {x: {cmds: [. "$HIVE_TASK_DIR/prepare-sccache-context.sh"]}}',
      ],
      ['agentic-ai/minds/hive/prepare-sccache-context.sh', 'DOCKER=unsafe'],
    ]),
    symlinkPaths: new Set(),
  };
  expect(() => configurationScriptPaths(graph)).toThrow('helper has drifted');
});

test('bounds action manifests and package metadata before parsing', () => {
  const manifest: ActionRuntimeGraph = {
    roots: ['action.yml'],
    sources: new Map([['action.yml', `#${'a'.repeat(65_537)}`]]),
    symlinkPaths: new Set(),
  };
  expect(() => actionRuntimePaths(manifest)).toThrow('UTF-8 byte bound');
  const inert = { inert: 'é'.repeat(32_768) };
  const action: ActionRuntimeGraph = {
    roots: ['action.yml'],
    sources: new Map([
      ['action.yml', 'runs: {using: node24, main: main.js}'],
      ['main.js', "import 'local/provider';"],
      ['package.json', JSON.stringify(inert)],
    ]),
    symlinkPaths: new Set(),
  };
  expect(() => actionRuntimePaths(action)).toThrow('UTF-8 byte bound');
});

test('bounds growing configuration cycles', () => {
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['Taskfile.yml'],
    sources: new Map([
      ['Taskfile.yml', 'tasks: {audit: {cmds: [bash scripts/a.sh]}}'],
      ['scripts/a.sh', 'bash scripts/b.sh x "$@"'],
      ['scripts/b.sh', 'bash scripts/a.sh x "$@"'],
    ]),
    symlinkPaths: new Set(),
  };
  expect(() => configurationScriptPaths(graph)).toThrow(
    'graph exceeds its bound',
  );
});
