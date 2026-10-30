import { expect, test } from 'bun:test';

import { join } from 'node:path';

import { SkillProviderConfigBoundaryScenario } from './skill-provider-config-boundary.test.ts';

import type { ConfigurationScriptGraph } from './skill-provider-executable-script.ts';

import type { ActionRuntimeGraph } from './skill-provider-config-types.ts';
import { SettledRejection } from './settled-rejection.ts';

export class SkillProviderCommandSecurityScenario {
  private constructor(private readonly request: string) {}

  static directGraph(command: string): ConfigurationScriptGraph {
    return new SkillProviderCommandSecurityScenario(command).execute();
  }

  private execute(): ConfigurationScriptGraph {
    const command = this.request;
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
}

const PROTECTED = '.agents/skills/example-skill/scripts/src/application.ts';

test('allows only the exact audited source catalog', async () => {
  expect(
    await SkillProviderConfigBoundaryScenario.configurationScriptPaths(
      SkillProviderCommandSecurityScenario.directGraph('. /etc/os-release'),
    ),
  ).toEqual([]);
  for (const command of [
    'source scripts/other.sh',
    '. scripts/other.sh',
    '. "$DYNAMIC"',
    'source /etc/lsb-release',
  ])
    expect(
      await SettledRejection.message(
        SkillProviderConfigBoundaryScenario.configurationScriptPaths(
          SkillProviderCommandSecurityScenario.directGraph(command),
        ),
      ),
    ).not.toBe(false);
});

test('repository PATH cannot shadow the trusted Docker CLI', async () => {
  const wrapper = '.github/scripts/with-healthy-buildkit.sh';
  const wrapperSource = await Bun.file(
    join(import.meta.dir, '../../..', wrapper),
  ).text();
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(['.agents/skills/example-skill/scripts/docker']),
    roots: ['Taskfile.yml'],
    sources: new Map([
      [
        'Taskfile.yml',
        `tasks: {x: {cmds: [PATH=.agents/skills/example-skill/scripts:$PATH bash ${wrapper}]}}`,
      ],
      [wrapper, wrapperSource],
      ['.agents/skills/example-skill/scripts/docker', `bun ${PROTECTED}`],
    ]),
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch('Command-scoped PATH mutation');
});

test('local web orchestration keeps every stage executable statically bounded', async () => {
  const wrapper = '.github/scripts/ci-pr-web-local.sh';
  const buildkitWrapper = '.github/scripts/with-healthy-buildkit.sh';
  const wrapperSource = await Bun.file(
    join(import.meta.dir, '../../..', wrapper),
  ).text();
  const buildkitWrapperSource = await Bun.file(
    join(import.meta.dir, '../../..', buildkitWrapper),
  ).text();
  const graph: ConfigurationScriptGraph = {
    executablePaths: new Set(),
    roots: ['Taskfile.yml'],
    sources: new Map([
      ['Taskfile.yml', `tasks: {x: {cmds: [bash ${wrapper}]}}`],
      [wrapper, wrapperSource],
      [buildkitWrapper, buildkitWrapperSource],
    ]),
    symlinkPaths: new Set(),
  };

  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toBe(false);

  const dynamicGraph: ConfigurationScriptGraph = {
    ...graph,
    sources: new Map(graph.sources).set(
      wrapper,
      `${wrapperSource}\nstage_command=(task ci:pr:wasm)\n"\${stage_command[@]}"`,
    ),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(
        dynamicGraph,
      ),
    ),
  ).toMatch('Unknown dynamic executable is forbidden');
});

test('bounds action manifests and package metadata before parsing', async () => {
  const manifest: ActionRuntimeGraph = {
    roots: ['action.yml'],
    sources: new Map([['action.yml', `#${'a'.repeat(65_537)}`]]),
    symlinkPaths: new Set(),
  };
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.actionRuntimePaths(manifest),
    ),
  ).toMatch('UTF-8 byte bound');
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
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.actionRuntimePaths(action),
    ),
  ).toMatch('UTF-8 byte bound');
});

test('bounds growing configuration cycles', async () => {
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
  expect(
    await SettledRejection.message(
      SkillProviderConfigBoundaryScenario.configurationScriptPaths(graph),
    ),
  ).toMatch('graph exceeds its bound');
});
