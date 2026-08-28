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
    'bun --cwd={{.dir}} cli.ts',
    'bun --cwd {{.dir}} cli.ts',
    'cd {{.dir}} && bun cli.ts',
  ];
  for (const [index, command] of commands.entries()) {
    const importer = index % 2 === 0 ? 'Taskfile.ci.yml' : '.task/audit.yml';
    const fixture: ExpansionFixture = {
      importer,
      source: `tasks:\n  audit:\n    cmds: ["${command}"]`,
    };
    expect(() => expandStaticTaskVariables(expansionRequest(fixture))).toThrow(
      'Task launch variable is unresolved or dynamic',
    );
  }
});
test('allows unresolved templates used only as ordinary arguments', () => {
  const fixture: ExpansionFixture = {
    importer: '.task/catalog.yml',
    source:
      'tasks:\n  list:\n    cmds: ["bun scripts/catalog.ts --label {{.LABEL}}"]',
  };
  expect(expandStaticTaskVariables(expansionRequest(fixture))).toContain(
    '--label {{.LABEL}}',
  );
});
