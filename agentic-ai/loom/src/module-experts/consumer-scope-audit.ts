import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { TypeScriptIncludeScan } from '../lib/typescript/include-scan.ts';
import {
  TypeScriptProgram,
  TypeScriptSourceKind,
  type TypeScriptSourceText,
} from '../lib/typescript/program.ts';
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

  static async discoverInternalApiConsumerPaths(
    repoRoot: string,
  ): Promise<readonly string[]> {
    const webRoot = join(repoRoot, InternalApiConsumerScope.WEB_ROOT);
    const includes = [
      '**/src/**/*.ts',
      '**/src/**/*.svelte',
      '**/scripts/build.ts',
      '**/scripts/verify-app-isolation.ts',
      '**/vite.config.ts',
      '**/vite-config.ts',
      '**/knip.json',
      '**/knip.ts',
      '**/tsconfig.json',
      '**/tsconfig.app.json',
      'tsconfig.eslint.json',
    ];
    const candidates = TypeScriptIncludeScan.scan({
      extensions: ['.json', '.svelte', '.ts'],
      includes,
      root: webRoot,
    }).filter((path) =>
      InternalApiConsumerScope.productionConsumerScopePath(
        relative(repoRoot, path).replaceAll('\\', '/'),
      ),
    );
    const inspections = candidates.map((path) =>
      InternalApiConsumerScope.bindingSourceInspection(path),
    );
    const sourceFiles = await TypeScriptProgram.parse(
      inspections.flatMap((inspection) => inspection.sources),
    );
    let cursor = 0;
    const consumers: string[] = [];
    for (const [index, path] of candidates.entries()) {
      const inspection = inspections[index];
      if (!inspection) throw new Error(`Missing binding inspection: ${path}`);
      const parsed = sourceFiles.slice(
        cursor,
        cursor + inspection.sources.length,
      );
      cursor += inspection.sources.length;
      if (
        parsed.some((sourceFile) =>
          InternalApiConsumerScope.sourceFileReferencesGeneratedBinding({
            bindingReferences: inspection.bindingReferences,
            sourceFile,
          }),
        )
      ) {
        consumers.push(relative(repoRoot, path).replaceAll('\\', '/'));
      }
    }
    return consumers.sort();
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

  private static bindingSourceInspection(
    sourcePath: string,
  ): BindingSourceInspection {
    const source = readFileSync(sourcePath, 'utf8');
    if (sourcePath.endsWith('.json')) {
      return {
        bindingReferences:
          InternalApiConsumerScope.JSON_GENERATED_BINDING_REFERENCES,
        sources: [
          {
            fileName: 'module-expert-consumer.json',
            kind: TypeScriptSourceKind.Json,
            text: source,
          },
        ],
      };
    }
    const typeScriptSources = sourcePath.endsWith('.svelte')
      ? InternalApiConsumerScope.extractSvelteTypeScriptSources(source)
      : [source];
    return {
      bindingReferences: InternalApiConsumerScope.GENERATED_BINDING_REFERENCES,
      sources: typeScriptSources.map((text) => ({
        fileName: 'module-expert-consumer.ts',
        kind: TypeScriptSourceKind.TypeScript,
        text,
      })),
    };
  }

  private static sourceFileReferencesGeneratedBinding(
    inspection: GeneratedBindingSourceInspection,
  ): boolean {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteralLikeNode(node) &&
        inspection.bindingReferences.some((binding) =>
          node.text.includes(binding),
        )
      ) {
        found = true;
        return;
      }
      node.forEachChild(visit);
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

type BindingSourceInspection = {
  readonly bindingReferences: readonly string[];
  readonly sources: readonly TypeScriptSourceText[];
};

type GeneratedBindingSourceInspection = {
  readonly bindingReferences: readonly string[];
  readonly sourceFile: ts.SourceFile;
};
