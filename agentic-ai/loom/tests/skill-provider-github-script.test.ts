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

test('github-script injected exec preserves exact cwd outside argv', () => {
  const script =
    "await exec['getExecOutput']('bun', ['scripts/facade.ts'], {cwd:'nested', silent:true})";
  const expectedReference = {
    positionalArguments: [],
    specifier: 'nested/scripts/facade.ts',
    workingDirectory: 'nested',
  };
  expect(references(script)).toContainEqual(
    expect.objectContaining(expectedReference),
  );
});

test('github-script injected exec dynamic forms fail closed', () => {
  for (const script of [
    "await exec.exec(command, ['scripts/facade.ts'])",
    "await exec.exec('bun', args)",
    "await exec[method]('bun', ['scripts/facade.ts'])",
    "const run = exec.exec; await run('bun', ['scripts/facade.ts'])",
    "await exec.exec('bun', ['scripts/facade.ts'], options)",
    "await exec.exec('bun', ['scripts/facade.ts'], {...options})",
    "await exec.exec('bun', ['scripts/facade.ts'], {cwd: directory})",
    "await exec.exec('bun', ['scripts/facade.ts'], {cwd:'one', cwd:'two'})",
    "await exec.exec('bun', ['scripts/facade.ts'], {[key]:'nested'})",
    "await exec.exec('bun', ['scripts/facade.ts'], {silent: enabled})",
    "await exec.exec('bun', ['scripts/facade.ts'], {env:{NODE_OPTIONS:'--require=hook.js'}})",
    "await exec.exec('bun', ['scripts/facade.ts'], {}, extra)",
  ])
    expect(() => references(script), script).toThrow(
      /(?:Ambiguous|Dynamic|Spread) github-script exec/u,
    );
});

test('github-script injected exec cwd stays repository-relative', () => {
  for (const cwd of ['/tmp', '../outside', 'C:\\outside']) {
    const script = `await exec.exec('bun', ['scripts/facade.ts'], {cwd:${JSON.stringify(cwd)}})`;
    expect(() => references(script), cwd).toThrow('cwd escapes the repository');
  }
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
