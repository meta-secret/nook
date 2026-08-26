import { expect, test } from 'bun:test';
import {
  type ExecutableProviderReferenceInspection,
  type ExecutableScriptInspection,
  executableSourceReferencesProvider,
  executableScriptViolatesBoundary,
  ShellExecutablePolicy,
} from './skill-provider-executable-script.ts';

function violatesBoundary(source: string): boolean {
  const inspection: ExecutableScriptInspection = {
    path: 'scripts/audit.ts',
    roots: new Set<string>(),
    shellPolicy: ShellExecutablePolicy.TrackedConfiguration,
    source,
    sources: new Map<string, string>(),
  };
  return executableScriptViolatesBoundary(inspection);
}

test('distinguishes inert provider path text from runtime imports', () => {
  expect(
    violatesBoundary(
      "const documentationPath = '.agents/skills/example/SKILL.md';",
    ),
  ).toBe(false);
  expect(
    violatesBoundary(
      "await import('../../../.agents/skills/example/src/runner.ts');",
    ),
  ).toBe(true);
});

test('normalizes only inert document capability checks', () => {
  expect(
    violatesBoundary(`if ('document' in globalThis) renderDocument();`),
  ).toBe(false);
  expect(
    violatesBoundary(`const runtime = globalThis; consume(runtime);`),
  ).toBe(true);
});

test('normalizes the exact async-dispose protocol member', () => {
  expect(violatesBoundary(`await agent[Symbol.asyncDispose]();`)).toBe(false);
  expect(violatesBoundary(`await agent[member]();`)).toBe(true);
});

test('distinguishes shell fixture paths from provider execution', () => {
  const inertInspection: ExecutableProviderReferenceInspection = {
    path: 'scripts/fixture.test.sh',
    source: `mkdir -p "$fixture_root/.agents/skills/demo/src"
printf '.agents/skills/*/src/**/*.ts' > expected.txt`,
  };
  const executedInspection: ExecutableProviderReferenceInspection = {
    path: 'scripts/run.sh',
    source: `bun .agents/skills/demo/src/run.ts`,
  };
  expect(executableSourceReferencesProvider(inertInspection)).toBe(false);
  expect(executableSourceReferencesProvider(executedInspection)).toBe(true);
});

test('normalizes exact CommonJS entrypoint and export contracts', () => {
  const inspection: ExecutableScriptInspection = {
    path: 'scripts/telemetry.cjs',
    roots: new Set<string>(),
    shellPolicy: ShellExecutablePolicy.TrackedConfiguration,
    source: `
const fs = require('node:fs');
if (require.main === module) consume(fs);
module.exports = { fs };
`,
    sources: new Map<string, string>(),
  };
  expect(executableScriptViolatesBoundary(inspection)).toBe(false);
});
