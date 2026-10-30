import { expect, test } from 'bun:test';

import { SkillProviderGithubScriptScenario } from './skill-provider-github-script.ts';

import type { ConfigurationReference } from './skill-provider-config-types.ts';
import { SettledRejection } from './settled-rejection.ts';

export class SkillProviderGithubScriptFixture {
  private constructor(private readonly request: string) {}

  static async references(
    script: string,
  ): Promise<readonly ConfigurationReference[]> {
    return new SkillProviderGithubScriptFixture(script).execute();
  }

  private async execute(): Promise<readonly ConfigurationReference[]> {
    const script = this.request;
    const request = {
      importer: '.github/workflows/audit.yml',
      positionalArguments: false as const,
      source: `jobs:\n  audit:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: ${JSON.stringify(script)}`,
      workingDirectory: '',
    };
    return await SkillProviderGithubScriptScenario.githubScriptConfigurationReferences(
      request,
    );
  }
}

test('github-script injected exec successors are audited', async () => {
  const expectedReference = { specifier: 'scripts/facade.ts' };
  for (const script of [
    "await exec.exec('bun', ['scripts/facade.ts'])",
    "await exec['exec']('bun', ['scripts/facade.ts'])",
    "await exec.getExecOutput('bun scripts/facade.ts')",
  ])
    expect(
      (await SkillProviderGithubScriptFixture.references(script)).some(
        ({ specifier }) => specifier === expectedReference.specifier,
      ),
      script,
    ).toBe(true);
});

test('github-script injected exec preserves exact cwd outside argv', async () => {
  const script =
    "await exec['getExecOutput']('bun', ['scripts/facade.ts'], {cwd:'nested', silent:true})";
  const expectedReference = {
    positionalArguments: [],
    specifier: 'nested/scripts/facade.ts',
    workingDirectory: 'nested',
  };
  expect(
    (await SkillProviderGithubScriptFixture.references(script)).some(
      (reference) =>
        reference.positionalArguments !== false &&
        reference.positionalArguments.length === 0 &&
        reference.specifier === expectedReference.specifier &&
        reference.workingDirectory === expectedReference.workingDirectory,
    ),
  ).toBe(true);
});

test('github-script injected exec dynamic forms fail closed', async () => {
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
    expect(
      await SettledRejection.message(
        SkillProviderGithubScriptFixture.references(script),
      ),
      script,
    ).toMatch(/(?:Ambiguous|Dynamic|Spread) github-script exec/u);
});

test('github-script injected exec cwd stays repository-relative', async () => {
  for (const cwd of ['/tmp', '../outside', 'C:\\outside']) {
    const script = `await exec.exec('bun', ['scripts/facade.ts'], {cwd:${JSON.stringify(cwd)}})`;
    expect(
      await SettledRejection.message(
        SkillProviderGithubScriptFixture.references(script),
      ),
      cwd,
    ).toMatch('cwd escapes the repository');
  }
});

test('github-script local exec shadows the injected client', async () => {
  const expectedReference = { specifier: 'scripts/facade.ts' };
  const script = "const exec={exec(){}}; exec.exec('bun', ['ignored.ts'])";
  expect(await SkillProviderGithubScriptFixture.references(script)).toEqual([]);
  const scoped =
    "{ const exec={exec(){}}; exec.exec('bun', ['ignored.ts']) } await exec.exec('bun', ['scripts/facade.ts'])";
  expect(
    (await SkillProviderGithubScriptFixture.references(scoped)).some(
      ({ specifier }) => specifier === expectedReference.specifier,
    ),
  ).toBe(true);
});

test('github-script rejects unresolved Actions expressions', async () => {
  expect(
    await SettledRejection.message(
      SkillProviderGithubScriptFixture.references(
        "require('${{ inputs.module }}')",
      ),
    ),
  ).toMatch('unresolved Actions expression');
});

test('github-script injected require aliases remain module loaders', async () => {
  for (const script of [
    "const load=require; load('./scripts/facade.cjs')",
    "const load=require; const loadAgain=load; loadAgain('./scripts/facade.cjs')",
    "__original_require__('./scripts/facade.cjs')",
    "const load=__original_require__; load('./scripts/facade.cjs')",
    "const load=__original_require__; const loadAgain=load; loadAgain('./scripts/facade.cjs')",
  ]) {
    const expected = { specifier: './scripts/facade.cjs' };
    expect(
      (await SkillProviderGithubScriptFixture.references(script)).some(
        ({ specifier }) => specifier === expected.specifier,
      ),
      script,
    ).toBe(true);
  }
});

test('github-script injected require aliases fail closed on escape', async () => {
  for (const script of [
    'const load=require; load(modulePath)',
    "let load=require; load('./scripts/facade.cjs')",
    'const load=require; consume(load)',
    'const load=require; return load',
    '__original_require__(modulePath)',
    "let load=__original_require__; load('./scripts/facade.cjs')",
    'const load=__original_require__; consume(load)',
    'const load=__original_require__; return load',
  ])
    expect(
      await SettledRejection.message(
        SkillProviderGithubScriptFixture.references(script),
      ),
      script,
    ).toMatch(/(?:module load|require capability escape)/u);
});

test('github-script local require shadows the injected loader', async () => {
  const script =
    'const require=(value)=>value; const load=require; load(modulePath)';
  expect(await SkillProviderGithubScriptFixture.references(script)).toEqual([]);
  const nested =
    "{ const require=(value)=>value; const load=require; load(modulePath) } const load=require; load('./scripts/facade.cjs')";
  const expected = { specifier: './scripts/facade.cjs' };
  expect(
    (await SkillProviderGithubScriptFixture.references(nested)).some(
      ({ specifier }) => specifier === expected.specifier,
    ),
  ).toBe(true);
});

test('github-script local original require shadows the injected loader', async () => {
  const script =
    'const __original_require__=(value)=>value; const load=__original_require__; load(modulePath)';
  expect(await SkillProviderGithubScriptFixture.references(script)).toEqual([]);
  const nested =
    "{ const __original_require__=(value)=>value; const load=__original_require__; load(modulePath) } const load=__original_require__; load('./scripts/facade.cjs')";
  const expected = { specifier: './scripts/facade.cjs' };
  expect(
    (await SkillProviderGithubScriptFixture.references(nested)).some(
      ({ specifier }) => specifier === expected.specifier,
    ),
  ).toBe(true);
});
