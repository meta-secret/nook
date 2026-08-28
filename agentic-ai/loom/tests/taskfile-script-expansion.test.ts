import { expect, test } from 'bun:test';
import {
  expandStaticTaskVariables,
  isTaskConfigurationPath,
} from './taskfile-script-expansion.ts';
type ExpansionFixture = {
  readonly importer: string;
  readonly source: string;
};
function expansionRequest(fixture: ExpansionFixture) {
  return {
    ...fixture,
    sources: new Map([[fixture.importer, fixture.source]]),
  };
}
test('recognizes Taskfile variants and nested Task fragments', () => {
  expect(
    [
      'Taskfile.yml',
      'Taskfile.ci.yaml',
      'nested/Taskfile.release.yml',
      '.task/a.yml',
    ].filter(isTaskConfigurationPath),
  ).toHaveLength(4);
});
test('rejects unresolved templates that can select a launch target', () => {
  const commands = [
    'bun {{.host | quote}}',
    'HOST={{.host}} $HOST',
    'env HOST={{.host}} bun $HOST',
    'env -i HOST={{.host}} bun ${HOST}',
    'env --unset OLD HOST={{.host}} bun $HOST',
    'env --chdir={{.dir}} bun cli.ts',
    'env -S "bun $HOST"',
    'bun --cwd={{.dir}} cli.ts',
    'bun --cwd {{.dir}} cli.ts',
    'bun scripts/$HOST.ts',
    'bun run $HOST',
    'bun run --silent $HOST',
    'bun run scripts/${HOST}.ts',
    'bun scripts/catalog.ts & $HOST',
    'cd {{.dir}} && bun cli.ts',
  ];
  for (const [index, command] of commands.entries()) {
    const importer = index % 2 === 0 ? 'Taskfile.ci.yml' : '.task/audit.yml';
    const fixture: ExpansionFixture = {
      importer,
      source: `tasks:\n  audit:\n    cmds: [${JSON.stringify(command)}]`,
    };
    expect(() => expandStaticTaskVariables(expansionRequest(fixture))).toThrow(
      'Task launch variable is unresolved or dynamic',
    );
  }
  for (const command of [
    'bun $HOST',
    'env HOST=scripts/catalog.ts bun $HOST',
  ]) {
    const dynamicEnvironment: ExpansionFixture = {
      importer: 'Taskfile.yml',
      source: `env:\n  HOST: {sh: echo scripts/catalog.ts}\ntasks:\n  audit:\n    cmds: [${JSON.stringify(command)}]`,
    };
    expect(() =>
      expandStaticTaskVariables(expansionRequest(dynamicEnvironment)),
    ).toThrow('Task launch variable is unresolved or dynamic');
  }
});
test('allows unresolved templates used only as ordinary arguments', () => {
  for (const command of [
    'bun scripts/catalog.ts --label {{.LABEL}}',
    'bun scripts/catalog.ts --label $LABEL',
    'bun run scripts/catalog.ts --label ${LABEL}',
    'bun run --silent scripts/catalog.ts --label $LABEL',
    'bun scripts/catalog.ts & bun scripts/other.ts',
    "HOST=scripts/catalog.ts bash -c 'bun $HOST'",
  ]) {
    const fixture: ExpansionFixture = {
      importer: '.task/catalog.yml',
      source: `tasks:\n  list:\n    cmds: [${JSON.stringify(command)}]`,
    };
    expect(expandStaticTaskVariables(expansionRequest(fixture))).toContain(
      command,
    );
  }
  const staticEnvironment: ExpansionFixture = {
    importer: 'Taskfile.yml',
    source:
      'env: {HOST: scripts/catalog.ts}\ntasks:\n  audit:\n    cmds: ["env -i bun $HOST"]',
  };
  expect(
    expandStaticTaskVariables(expansionRequest(staticEnvironment)),
  ).toContain('scripts/catalog.ts');
});
