import { expect, test } from 'bun:test';
import { analyzeShellCommands } from './skill-provider-command-boundary.ts';
import { configurationScriptPaths } from './skill-provider-config-boundary.test.ts';
import { runnableCommandSources } from './skill-provider-config-commands.ts';
import { isRunnableConfiguration } from './skill-provider-config-runtime.ts';
import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';

const PROVIDER_ROOT = '.cortex/teams/ai/dynamic-skills/example/scripts/src';
const PROVIDER_CLI = `${PROVIDER_ROOT}/cli.ts`;

type GraphRequest = {
  readonly roots: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
};

function graph(request: GraphRequest): ConfigurationScriptGraph {
  return {
    executablePaths: new Set(),
    roots: request.roots,
    sources: request.sources,
    symlinkPaths: new Set(),
  };
}

function expectProviderReachable(candidate: ConfigurationScriptGraph): void {
  expect(configurationScriptPaths(candidate)).toContain(PROVIDER_CLI);
}

test('nested package scripts resolve relative to their package first', () => {
  const sources = new Map([
    ['nested/package.json', '{"scripts":{"audit":"bun scripts/a.ts"}}'],
    ['scripts/a.ts', 'export {};'],
    ['nested/scripts/a.ts', `await import('${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['nested/package.json'], sources };
  expectProviderReachable(graph(request));
});

test('Vite configs are runnable roots', () => {
  expect(isRunnableConfiguration('nested/vite.config.ts')).toBe(true);
  expect(isRunnableConfiguration('nested/vite.config.mjs')).toBe(true);
  const vite = 'nested/vite.config.ts';
  const sources = new Map([
    [vite, `await import('${PROVIDER_CLI}');`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: [vite], sources };
  expectProviderReachable(graph(request));
});

test('global Task vars and env shell values remain executable', () => {
  const source = `
vars:
  GENERATED: {sh: bun ${PROVIDER_CLI}}
env:
  CHECKED: {sh: bun ${PROVIDER_CLI}}
  ROOT: ${PROVIDER_ROOT}
tasks:
  audit:
    cmds: [bun "$ROOT/cli.ts"]
`;
  const commandInspection = {
    path: 'Taskfile.yml',
    source,
  };
  const launches = runnableCommandSources(commandInspection).flatMap(
    (command) => {
      const shellInspection = {
        positionalArguments: false,
        source: command,
        sourcePath: 'Taskfile.yml',
      } as const;
      return analyzeShellCommands(shellInspection).launches;
    },
  );
  expect(launches.map((launch) => launch.specifier)).toEqual([
    PROVIDER_CLI,
    PROVIDER_CLI,
    PROVIDER_CLI,
  ]);
});

test('argv-driven TypeScript loaders are checked fail-closed', () => {
  const sources = new Map([
    [
      'Taskfile.yml',
      `tasks: {audit: {cmds: [bun scripts/loader.ts ${PROVIDER_CLI}]}}`,
    ],
    ['scripts/loader.ts', 'await import(process.argv[2]);'],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['Taskfile.yml'], sources };
  expectProviderReachable(graph(request));
});

test('Task includes with arbitrary filenames join the runnable graph', () => {
  const included = 'infra/tasks/custom.yml';
  const sources = new Map([
    ['infra/Taskfile.yml', `includes: {custom: {taskfile: tasks/custom.yml}}`],
    [included, `tasks: {audit: {cmds: [bun ${PROVIDER_CLI}]}}`],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: ['infra/Taskfile.yml'], sources };
  expectProviderReachable(graph(request));
});

test('workflow env precedence is propagated into run analysis', () => {
  const workflow = '.github/workflows/audit.yml';
  const sources = new Map([
    [
      workflow,
      `env: {ROOT: safe}\njobs: {audit: {env: {ROOT: ${PROVIDER_ROOT}}, steps: [{env: {UNUSED: value}, run: 'bun "$ROOT/cli.ts"'}]}}`,
    ],
    [PROVIDER_CLI, 'export {};'],
  ]);
  const request = { roots: [workflow], sources };
  expectProviderReachable(graph(request));
});

test('extensionless TypeScript imports are resolved before optional pruning', () => {
  for (const [specifier, dependency] of [
    ['./nested', 'scripts/nested.ts'],
    ['./directory', 'scripts/directory/index.js'],
  ] as const) {
    const sources = new Map([
      ['package.json', '{"scripts":{"audit":"bun scripts/loader.ts"}}'],
      ['scripts/loader.ts', `import '${specifier}';`],
      [specifier === './nested' ? 'scripts/nested' : 'scripts/directory', ''],
      [dependency, `await import('${PROVIDER_CLI}');`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['package.json'], sources };
    expectProviderReachable(graph(request));
  }
});

test('runtime-launched extensionless files do not require execute mode', () => {
  for (const runtime of ['bun', 'node']) {
    const sources = new Map([
      ['package.json', `{"scripts":{"audit":"${runtime} scripts/loader"}}`],
      ['scripts/loader', `await import('../${PROVIDER_CLI}');`],
      [PROVIDER_CLI, 'export {};'],
    ]);
    const request = { roots: ['package.json'], sources };
    expectProviderReachable(graph(request));
  }
});

test('workflow and composite custom shells fail closed', () => {
  for (const [path, source] of [
    [
      '.github/workflows/default.yml',
      'defaults: {run: {shell: scripts/runner {0}}}\njobs: {audit: {steps: [{run: echo safe}]}}',
    ],
    [
      '.github/workflows/step.yml',
      'jobs: {audit: {steps: [{shell: "${{ matrix.shell }}", run: echo safe}]}}',
    ],
    [
      '.github/actions/audit/action.yml',
      'runs: {using: composite, steps: [{shell: scripts/runner {0}, run: echo safe}]}',
    ],
  ] as const) {
    const inspection = { path, source };
    expect(() => runnableCommandSources(inspection), path).toThrow(
      /(?:Custom|Dynamic) workflow shell is forbidden/u,
    );
  }
});
