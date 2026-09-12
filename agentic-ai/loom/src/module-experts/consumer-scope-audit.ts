import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { INTERNAL_API_EXPERT_CONSUMER_SCOPE_PATHS } from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';

/** Owns the internal api consumer scope registry and its capability transitions. */
export class InternalApiConsumerScope {
  private constructor() {}
  private static readonly WEB_ROOT = 'nook-app/nook-web';

  private static readonly GENERATED_BINDING_REFERENCES = [
    '$app-wasm',
    'nook-wasm/nook_wasm',
    'nook-companion-wasm/nook_companion_wasm',
  ] as const;

  private static readonly JSON_GENERATED_BINDING_REFERENCES = [
    '$app-wasm',
    'nook-wasm',
    'nook-companion-wasm',
  ] as const;

  private static readonly EXCLUDED_CONSUMER_SCOPE_PREFIXES = [
    'nook-app/nook-web/nook-web-research/',
    'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/',
    'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/',
  ] as const;

  private static readonly EXCLUDED_CONSUMER_SCOPE_SEGMENTS = [
    '/e2e/',
    '/tests/',
  ] as const;

  private static readonly EXCLUDED_CONSUMER_SCOPE_SUFFIXES = [
    '.spec.svelte',
    '.spec.ts',
    '.test.svelte',
    '.test.ts',
  ] as const;

  static auditInternalApiExpertConsumerScope(
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
        path: 'agentic-ai/loom/src/module-experts/catalog.ts',
        message:
          'internal_api_expert must declare every authored production TypeScript, Svelte, or JSON configuration file that directly imports, configures, or resolves a generated WASM binding, and no broader scope.',
      },
    ];
  }

  static discoverInternalApiConsumerPaths(repoRoot: string): readonly string[] {
    const webRoot = join(repoRoot, InternalApiConsumerScope.WEB_ROOT);
    const includes = [
      '**/src/**/*.ts',
      '**/src/**/*.svelte',
      '**/scripts/build.ts',
      '**/scripts/verify-app-isolation.ts',
      '**/vite.config.ts',
      '**/vite-config.ts',
      '**/knip.json',
      '**/tsconfig.json',
      '**/tsconfig.app.json',
      'tsconfig.eslint.json',
    ];
    return ts.sys
      .readDirectory(webRoot, ['.json', '.svelte', '.ts'], [], includes)
      .filter((path) => {
        const repoPath = relative(repoRoot, path).replaceAll('\\', '/');
        return (
          InternalApiConsumerScope.productionConsumerScopePath(repoPath) &&
          InternalApiConsumerScope.referencesGeneratedBinding(path)
        );
      })
      .map((path) => relative(repoRoot, path).replaceAll('\\', '/'))
      .sort();
  }

  private static productionConsumerScopePath(repoPath: string): boolean {
    return (
      !InternalApiConsumerScope.EXCLUDED_CONSUMER_SCOPE_PREFIXES.some(
        (prefix) => repoPath.startsWith(prefix),
      ) &&
      !InternalApiConsumerScope.EXCLUDED_CONSUMER_SCOPE_SEGMENTS.some(
        (segment) => repoPath.includes(segment),
      ) &&
      !InternalApiConsumerScope.EXCLUDED_CONSUMER_SCOPE_SUFFIXES.some(
        (suffix) => repoPath.endsWith(suffix),
      )
    );
  }

  private static referencesGeneratedBinding(sourcePath: string): boolean {
    const source = readFileSync(sourcePath, 'utf8');
    if (sourcePath.endsWith('.json')) {
      const inspection: GeneratedBindingSourceInspection = {
        bindingReferences:
          InternalApiConsumerScope.JSON_GENERATED_BINDING_REFERENCES,
        sourceFile: ts.parseJsonText('module-expert-consumer.json', source),
      };
      return InternalApiConsumerScope.sourceFileReferencesGeneratedBinding(
        inspection,
      );
    }
    const typeScriptSources = sourcePath.endsWith('.svelte')
      ? InternalApiConsumerScope.extractSvelteTypeScriptSources(source)
      : [source];
    return typeScriptSources.some(
      InternalApiConsumerScope.typeScriptSourceReferencesGeneratedBinding,
    );
  }

  private static typeScriptSourceReferencesGeneratedBinding(
    source: string,
  ): boolean {
    const sourceFile = ts.createSourceFile(
      'module-expert-consumer.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const inspection: GeneratedBindingSourceInspection = {
      bindingReferences: InternalApiConsumerScope.GENERATED_BINDING_REFERENCES,
      sourceFile,
    };
    return InternalApiConsumerScope.sourceFileReferencesGeneratedBinding(
      inspection,
    );
  }

  private static sourceFileReferencesGeneratedBinding(
    inspection: GeneratedBindingSourceInspection,
  ): boolean {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteralLike(node) &&
        inspection.bindingReferences.some((binding) =>
          node.text.includes(binding),
        )
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(inspection.sourceFile);
    return found;
  }

  private static extractSvelteTypeScriptSources(
    source: string,
  ): readonly string[] {
    const scripts: string[] = [];
    let cursor = 0;
    while (cursor < source.length) {
      const openingStart = source.indexOf('<script', cursor);
      if (openingStart < 0) break;
      const openingEnd = source.indexOf('>', openingStart + '<script'.length);
      if (openingEnd < 0) break;
      const closingStart = source.indexOf('</script>', openingEnd + 1);
      if (closingStart < 0) break;
      const attributes = source.slice(
        openingStart + '<script'.length,
        openingEnd,
      );
      if (/\blang\s*=\s*(?:"ts"|'ts')/.test(attributes)) {
        scripts.push(source.slice(openingEnd + 1, closingStart));
      }
      cursor = closingStart + '</script>'.length;
    }
    return scripts;
  }
}

export type InternalApiConsumerScopeFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type AuditInternalApiExpertConsumerScopeArgs = {
  readonly discoveredConsumerPaths: readonly string[];
  readonly profile: ModuleExpertProfile;
};

type GeneratedBindingSourceInspection = {
  readonly bindingReferences: readonly string[];
  readonly sourceFile: ts.SourceFile;
};
