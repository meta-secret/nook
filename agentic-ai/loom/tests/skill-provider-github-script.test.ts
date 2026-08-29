import { expect, test } from 'bun:test';
import { githubScriptConfigurationReferences } from './skill-provider-github-script.ts';

function references(script: string) {
  const request = {
    importer: '.github/workflows/audit.yml',
    positionalArguments: false as const,
    source: `jobs:\n  audit:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: ${JSON.stringify(script)}`,
    workingDirectory: '',
  };
  return githubScriptConfigurationReferences(request);
}

test('github-script injected exec successors are audited', () => {
  const expectedReference = { specifier: 'scripts/facade.ts' };
  const partialReference = expect.objectContaining(expectedReference);
  for (const script of [
    "await exec.exec('bun', ['scripts/facade.ts'])",
    "await exec['exec']('bun', ['scripts/facade.ts'])",
    "await exec.getExecOutput('bun scripts/facade.ts')",
  ])
    expect(references(script), script).toContainEqual(partialReference);
});

test('github-script injected exec dynamic forms fail closed', () => {
  for (const script of [
    "await exec.exec(command, ['scripts/facade.ts'])",
    "await exec.exec('bun', args)",
    "await exec[method]('bun', ['scripts/facade.ts'])",
    "const run = exec.exec; await run('bun', ['scripts/facade.ts'])",
  ])
    expect(() => references(script), script).toThrow(
      /Dynamic github-script exec/u,
    );
});

test('github-script local exec shadows the injected client', () => {
  const expectedReference = { specifier: 'scripts/facade.ts' };
  const partialReference = expect.objectContaining(expectedReference);
  const script = "const exec={exec(){}}; exec.exec('bun', ['ignored.ts'])";
  expect(references(script)).toEqual([]);
  const scoped =
    "{ const exec={exec(){}}; exec.exec('bun', ['ignored.ts']) } await exec.exec('bun', ['scripts/facade.ts'])";
  expect(references(scoped)).toContainEqual(partialReference);
});
