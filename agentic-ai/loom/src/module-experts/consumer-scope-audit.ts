import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS } from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';

const WEB_ROOT = 'nook-app/nook-web';
const GENERATED_BINDING_REFERENCES = [
  '$app-wasm',
  'nook-wasm/nook_wasm',
  'nook-companion-wasm/nook_companion_wasm',
] as const;
const EXCLUDED_CONSUMER_SCOPE_PREFIXES = [
  'nook-app/nook-web/nook-web-research/',
  'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/',
  'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/',
] as const;

export type InternalApiConsumerScopeFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type AuditInternalApiExpertConsumerScopeArgs = {
  readonly discoveredConsumerPaths: readonly string[];
  readonly profile: ModuleExpertProfile;
};

export function auditInternalApiExpertConsumerScope(
  args: AuditInternalApiExpertConsumerScopeArgs,
): readonly InternalApiConsumerScopeFinding[] {
  const catalogMatches =
    JSON.stringify(args.profile.scopePaths) ===
    JSON.stringify(INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS);
  const sourceMatches =
    JSON.stringify(args.profile.scopePaths) ===
    JSON.stringify(args.discoveredConsumerPaths);
  if (catalogMatches && sourceMatches) return [];
  return [
    {
      code: 'invalid-internal-api-consumer-scope',
      path: args.profile.agentDefinitionPath,
      message:
        'internal_api_expert must declare every authored production TypeScript file that directly imports, configures, or resolves a generated WASM binding, and no broader scope.',
    },
  ];
}

export function discoverInternalApiConsumerPaths(
  repoRoot: string,
): readonly string[] {
  const webRoot = join(repoRoot, WEB_ROOT);
  const includes = [
    '**/src/**/*.ts',
    '**/scripts/build.ts',
    '**/scripts/verify-app-isolation.ts',
    '**/vite.config.ts',
    '**/vite-config.ts',
  ];
  return ts.sys
    .readDirectory(webRoot, ['.ts'], [], includes)
    .filter(
      (path) =>
        !EXCLUDED_CONSUMER_SCOPE_PREFIXES.some((prefix) =>
          relative(repoRoot, path).replaceAll('\\', '/').startsWith(prefix),
        ) && referencesGeneratedBinding(path),
    )
    .map((path) => relative(repoRoot, path).replaceAll('\\', '/'))
    .sort();
}

function referencesGeneratedBinding(sourcePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) &&
      GENERATED_BINDING_REFERENCES.some((binding) =>
        node.text.includes(binding),
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
