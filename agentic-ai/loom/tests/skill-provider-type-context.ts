import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type * as ts from 'typescript/unstable/ast';

import { TypeScriptCheckerFacts } from '../src/lib/typescript/checker-facts.ts';
import { TypeScriptIncludeScan } from '../src/lib/typescript/include-scan.ts';
import {
  TypeScriptProgram,
  TypeScriptSourceKind,
} from '../src/lib/typescript/program.ts';
import { TypeScriptTestSources } from './typescript-test-sources.ts';

export class SkillProviderTypeContextScenario {
  private constructor(
    private readonly request: SkillProviderSourceInspection,
  ) {}

  /**
   * The checked view of one source. A context depends only on its path and
   * text, and the scenarios inspect the same sources repeatedly, so each
   * distinct snippet is compiled once per test process.
   */
  static async createSkillProviderTypeContext(
    inspection: SkillProviderSourceInspection,
  ): Promise<SkillProviderTypeContext> {
    if (
      SkillProviderTypeContextScenario.isCurrentProductionSource(inspection)
    ) {
      return SkillProviderTypeContextScenario.productionSourceContext(
        inspection,
      );
    }
    const key = `${inspection.filePath}\0${inspection.source}`;
    const cached = SNIPPET_CONTEXTS.get(key);
    if (cached) return cached;
    const context = new SkillProviderTypeContextScenario(inspection).execute();
    SNIPPET_CONTEXTS.set(key, context);
    return context;
  }

  private async execute(): Promise<SkillProviderTypeContext> {
    const inspection = this.request;
    // An isolated program: the inspected source and the default libraries,
    // with no repository file, module, or type root reachable.
    const program = await TypeScriptTestSources.open({
      compilerOptions: BOUNDARY_COMPILER_OPTIONS,
      sources: [
        {
          fileName: inspection.filePath,
          kind: TypeScriptSourceKind.TypeScript,
          text: inspection.source,
        },
      ],
    });
    try {
      const [sourceFile] = await program.sourceFiles();
      if (!sourceFile) {
        throw new Error(
          `Boundary source was not compiled: ${inspection.filePath}`,
        );
      }
      const checker = await TypeScriptCheckerFacts.collect({
        checker: program.checker,
        names: true,
        sourceFile,
        types: true,
      });
      return { checker, sourceFile };
    } finally {
      await program.close();
    }
  }

  static isCurrentProductionSource(
    inspection: SkillProviderSourceInspection,
  ): boolean {
    if (!inspection.filePath.startsWith(PRODUCTION_LOOM_PREFIX)) return false;
    const diskPath = join(REPOSITORY_ROOT, inspection.filePath);
    if (!existsSync(diskPath)) return false;
    const diskSource = readFileSync(diskPath, 'utf8');
    return (
      SkillProviderTypeContextScenario.normalizedSource(diskSource) ===
      SkillProviderTypeContextScenario.normalizedSource(inspection.source)
    );
  }

  static normalizedSource(source: string): string {
    return source.replace(/^#![^\n]*(?:\n|$)/u, '');
  }

  static async productionSourceContext(
    inspection: SkillProviderSourceInspection,
  ): Promise<SkillProviderTypeContext> {
    const program =
      await SkillProviderTypeContextScenario.warmProductionBoundaryProgram();
    const absolutePath = join(REPOSITORY_ROOT, inspection.filePath);
    const cached = PRODUCTION_CONTEXTS.get(absolutePath);
    if (cached) {
      SkillProviderTypeContextScenario.assertCurrentProductionSource({
        inspection,
        sourceFile: cached.sourceFile,
      });
      return cached;
    }
    const sourceFile = await program.sourceFile(absolutePath);
    if (!sourceFile) {
      throw new Error(
        `Production boundary source is stale: ${inspection.filePath}`,
      );
    }
    SkillProviderTypeContextScenario.assertCurrentProductionSource({
      inspection,
      sourceFile,
    });
    const checker = await TypeScriptCheckerFacts.collect({
      checker: program.checker,
      names: true,
      sourceFile,
      types: true,
    });
    const context: SkillProviderTypeContext = { checker, sourceFile };
    PRODUCTION_CONTEXTS.set(absolutePath, context);
    return context;
  }

  /** Opens, once per test process, the program over Loom's production sources. */
  static async warmProductionBoundaryProgram(): Promise<TypeScriptProgram> {
    if (productionBoundaryProgram === false) {
      const rootFiles = TypeScriptIncludeScan.scan({
        extensions: PRODUCTION_SOURCE_EXTENSIONS,
        includes: PRODUCTION_SOURCE_INCLUDES,
        root: join(LOOM_ROOT, 'src'),
      });
      productionBoundaryProgram = TypeScriptProgram.openDisk({
        compilerOptions: BOUNDARY_COMPILER_OPTIONS,
        rootFiles,
      });
    }
    return productionBoundaryProgram;
  }

  private static assertCurrentProductionSource(request: {
    readonly inspection: SkillProviderSourceInspection;
    readonly sourceFile: ts.SourceFile;
  }): void {
    if (
      SkillProviderTypeContextScenario.normalizedSource(
        request.sourceFile.text,
      ) !==
      SkillProviderTypeContextScenario.normalizedSource(
        request.inspection.source,
      )
    ) {
      throw new Error(
        `Production boundary source is stale: ${request.inspection.filePath}`,
      );
    }
  }
}

export type SkillProviderSourceInspection = {
  readonly allowUnprovenComputedDataAccess?: true;
  readonly filePath: string;
  readonly source: string;
};

export type SkillProviderTypeContext = {
  readonly checker: TypeScriptCheckerFacts;
  readonly sourceFile: ts.SourceFile;
};

const LOOM_ROOT = join(import.meta.dir, '..');

const REPOSITORY_ROOT = join(LOOM_ROOT, '../..');

const PRODUCTION_LOOM_PREFIX = 'agentic-ai/loom/src/';

const BOUNDARY_COMPILER_OPTIONS = {
  allowJs: true,
  allowImportingTsExtensions: true,
  module: 'esnext',
  moduleResolution: 'bundler',
  noEmit: true,
  strict: true,
  target: 'es2022',
  typeRoots: [join(LOOM_ROOT, 'node_modules/@types')],
  types: ['bun'],
} as const;

export const PRODUCTION_SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

const PRODUCTION_SOURCE_INCLUDES = ['**/*'];

const PRODUCTION_CONTEXTS = new Map<string, SkillProviderTypeContext>();

const SNIPPET_CONTEXTS = new Map<string, Promise<SkillProviderTypeContext>>();

let productionBoundaryProgram: Promise<TypeScriptProgram> | false = false;
