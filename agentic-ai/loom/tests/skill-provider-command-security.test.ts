import { expect, test } from 'bun:test';
import {
  actionRuntimePaths,
  configurationScriptPaths,
} from './skill-provider-config-boundary.test.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';
import type { ActionRuntimeGraph } from './skill-provider-config-types.ts';

function directGraph(command: string): ConfigurationScriptGraph {
  const root =
    command === '. /etc/os-release'
      ? 'infra/tasks/providers.yml'
      : 'Taskfile.yml';
  return {
    executablePaths: new Set(),
    roots: [root],
    sources: new Map([[root, `tasks: {audit: {cmds: [${command}]}}`]]),
    symlinkPaths: new Set(),
  };
}

test('allows only the exact audited source catalog', () => {
  expect(configurationScriptPaths(directGraph('. /etc/os-release'))).toEqual(
    [],
  );
  for (const command of [
    'source scripts/other.sh',
    '. scripts/other.sh',
    '. "$DYNAMIC"',
    'source /etc/lsb-release',
  ])
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
      ['agentic-ai/minds/hive/prepare-sccache-context.sh', 'echo unsafe'],
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
