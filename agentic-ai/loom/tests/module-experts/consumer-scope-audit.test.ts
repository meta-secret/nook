import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import {
  auditInternalApiExpertConsumerScope,
  discoverInternalApiConsumerPaths,
} from '../../src/module-experts/consumer-scope-audit.ts';
import type { AuditInternalApiExpertConsumerScopeArgs } from '../../src/module-experts/consumer-scope-audit.ts';
import {
  INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS,
  INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS,
  MODULE_EXPERT_CATALOG,
} from '../../src/module-experts/catalog.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

test('discovers exact production JSON binding resolver configurations', () => {
  const discovered = discoverInternalApiConsumerPaths(REPO_ROOT);
  expect(discovered.filter((path) => path.endsWith('.json'))).toEqual([
    ...INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS,
  ]);
  expect(discovered).toEqual(INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS);
});

test('parses bounded JSON and JSONC configs without broad JSON discovery', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-json-scope-'));
  const removeOptions: RmOptions = { recursive: true, force: true };
  const fixtureFiles = new Map<string, string>([
    [
      'nook-app/nook-web/example/tsconfig.json',
      '{ /* JSONC */ "compilerOptions": { "paths": { "$app-wasm": ["../nook-wasm/nook_wasm"] } } }\n',
    ],
    [
      'nook-app/nook-web/example/knip.json',
      '{ "project": ["../nook-companion-wasm/nook_companion_wasm"] }\n',
    ],
    ['nook-app/nook-web/example/config.json', '{ "path": "$app-wasm" }\n'],
    [
      'nook-app/nook-web/example/e2e/tsconfig.json',
      '{ "compilerOptions": { "paths": { "$app-wasm": ["mock"] } } }\n',
    ],
    [
      'nook-app/nook-web/nook-web-research/tsconfig.json',
      '{ "compilerOptions": { "paths": { "$app-wasm": ["research"] } } }\n',
    ],
  ]);
  const directoryOptions: MakeDirectoryOptions = { recursive: true };
  try {
    for (const [path, source] of fixtureFiles) {
      const absolutePath = join(fixtureRoot, path);
      await mkdir(dirname(absolutePath), directoryOptions);
      await writeFile(absolutePath, source, 'utf8');
    }
    expect(discoverInternalApiConsumerPaths(fixtureRoot)).toEqual([
      'nook-app/nook-web/example/knip.json',
      'nook-app/nook-web/example/tsconfig.json',
    ]);
  } finally {
    await rm(fixtureRoot, removeOptions);
  }
});

test('rejects missing and overbroad JSON resolver scope', () => {
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === 'internal_api_expert',
  );
  if (!profile) throw new Error('internal_api_expert fixture is missing.');
  const discovered = discoverInternalApiConsumerPaths(REPO_ROOT);
  const missingJsonProfile = {
    ...profile,
    scopePaths: profile.scopePaths.filter(
      (path) => path !== INTERNAL_API_EXPERT_JSON_CONSUMER_SCOPE_PATHS[0],
    ),
  };
  const missingArgs: AuditInternalApiExpertConsumerScopeArgs = {
    discoveredConsumerPaths: discovered,
    profile: missingJsonProfile,
  };
  expect(auditInternalApiExpertConsumerScope(missingArgs)).toHaveLength(1);

  const overbroadArgs: AuditInternalApiExpertConsumerScopeArgs = {
    discoveredConsumerPaths: [...discovered, 'nook-app/nook-web/package.json'],
    profile,
  };
  expect(auditInternalApiExpertConsumerScope(overbroadArgs)).toHaveLength(1);
});
