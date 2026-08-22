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
        'internal_api_expert must declare every authored production TypeScript file that directly imports a generated WASM binding, and no broader scope.',
    },
  ];
}

export function discoverInternalApiConsumerPaths(
  repoRoot: string,
): readonly string[] {
  const webRoot = join(repoRoot, WEB_ROOT);
  const includes = ['**/src/**/*.ts', '**/scripts/build.ts'];
  return ts.sys
    .readDirectory(webRoot, ['.ts'], [], includes)
    .filter(
      (path) =>
        !EXCLUDED_CONSUMER_SCOPE_PREFIXES.some((prefix) =>
          relative(repoRoot, path).replaceAll('\\', '/').startsWith(prefix),
        ) && importsGeneratedBinding(path),
    )
    .map((path) => relative(repoRoot, path).replaceAll('\\', '/'))
    .sort();
}

function importsGeneratedBinding(sourcePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      return false;
    }
    const moduleSpecifier = statement.moduleSpecifier;
    if (!moduleSpecifier) return false;
    return (
      ts.isStringLiteralLike(moduleSpecifier) &&
      GENERATED_BINDING_REFERENCES.some((binding) =>
        moduleSpecifier.text.includes(binding),
      )
    );
  });
}
