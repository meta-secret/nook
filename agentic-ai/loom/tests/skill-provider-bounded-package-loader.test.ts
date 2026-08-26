import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';
import {
  specializeBoundedLocalDataLoaders,
  specializeBoundedPackageLoaders,
  specializeProvenGeneratedArtifactLoader,
} from './skill-provider-bounded-package-loader.ts';

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');

test('specializes only closed finite external package loaders', async () => {
  const path = 'nook-app/nook-web/nook-web-extension/scripts/build.ts';
  const packagePath = 'nook-app/nook-web/nook-web-app/package.json';
  const sources = new Map<string, string>([
    [path, await Bun.file(join(REPOSITORY_ROOT, path)).text()],
    [packagePath, await Bun.file(join(REPOSITORY_ROOT, packagePath)).text()],
  ]);
  const inspection = {
    path,
    roots: new Set<string>(),
    source: sources.get(path) ?? '',
    sources,
  };
  const specialized = specializeBoundedPackageLoaders(inspection);
  expect(specialized).toContain("from 'bounded-package-loader'");
  expect(specialized).toContain('return Promise.resolve(false)');
  const sourceInspection = {
    allowUnprovenComputedDataAccess: true as const,
    filePath: path,
    source: specialized,
  };
  expect(violatesSkillProviderBoundary(sourceInspection)).toBe(false);
});

test('specializes only closed tracked local data modules', async () => {
  const path = 'nook-app/nook-web/nook-web-app/scripts/generate-i18n-keys.mjs';
  const modulePath = 'nook-app/nook-web/nook-web-app/src/landing/messages.js';
  const sources = new Map<string, string>([
    [path, await Bun.file(join(REPOSITORY_ROOT, path)).text()],
    [modulePath, await Bun.file(join(REPOSITORY_ROOT, modulePath)).text()],
  ]);
  const inspection = {
    path,
    roots: new Set<string>(),
    source: sources.get(path) ?? '',
    sources,
  };
  const specialized = specializeBoundedLocalDataLoaders(inspection);
  expect(specialized).toContain("await import('../src/landing/messages.js')");
  const sourceInspection = {
    allowUnprovenComputedDataAccess: true as const,
    filePath: path,
    source: specialized,
  };
  expect(violatesSkillProviderBoundary(sourceInspection)).toBe(false);
});

test('does not specialize escaped, computed, or repository-backed loaders', () => {
  const base = [
    "import { createRequire } from 'node:module';",
    "import { pathToFileURL } from 'node:url';",
    "const requireFromRoot = createRequire('/repo/package.json');",
    'async function load(specifier: string) {',
    '  const resolved = requireFromRoot.resolve(specifier);',
    '  return import(pathToFileURL(resolved).href);',
    '}',
  ].join('\n');
  for (const tail of [
    'const escaped = load;',
    'await load(computed);',
    "await load('@nook/local');",
  ]) {
    const source = `${base}\n${tail}`;
    const sources = new Map<string, string>([
      ['scripts/load.ts', source],
      ['packages/local/package.json', '{"name":"@nook/local"}'],
    ]);
    const inspection = {
      path: 'scripts/load.ts',
      roots: new Set<string>(),
      source,
      sources,
    };
    expect(specializeBoundedPackageLoaders(inspection), tail).toBe(source);
  }
});

test('specializes only exact source-closed generated artifacts', async () => {
  const path = 'nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts';
  const producerPath = 'nook-app/nook-web/nook-web-app/vite.config.ts';
  const envPath = 'nook-app/nook-web/nook-web-app/.env.site';
  const workerPath =
    'nook-app/nook-web/nook-web-app/cloudflare-pages/legacy-route-worker.js';
  const sources = new Map<string, string>();
  for (const sourcePath of [path, producerPath, envPath, workerPath]) {
    sources.set(
      sourcePath,
      await Bun.file(join(REPOSITORY_ROOT, sourcePath)).text(),
    );
  }
  const roots = new Set([producerPath, envPath]);
  const source = sources.get(path) ?? '';
  const inspection = { path, roots, source, sources };
  const specialized = specializeProvenGeneratedArtifactLoader(inspection);
  expect(specialized).toContain(
    "await import('../cloudflare-pages/legacy-route-worker.js')",
  );

  for (const unsafeSource of [
    source.replace("'_worker.js'", "'_sibling.js'"),
    source.replace('Date.now()', 'callerNonce()'),
  ]) {
    const unsafeInspection = { path, roots, source: unsafeSource, sources };
    expect(specializeProvenGeneratedArtifactLoader(unsafeInspection)).toBe(
      unsafeSource,
    );
  }
  const unprovenInspection = {
    path,
    roots: new Set([envPath]),
    source,
    sources,
  };
  expect(specializeProvenGeneratedArtifactLoader(unprovenInspection)).toBe(
    source,
  );
});
