import { join } from 'node:path';
import { expect, test } from 'bun:test';
import ts from 'typescript';

type LoomSourceScanOptions = {
  readonly cwd: string;
  readonly onlyFiles: true;
};

const LOOM_ROOT = join(import.meta.dir, '..');
type SkillProviderImportInspection = {
  readonly filePath: string;
  readonly source: string;
};

function importsSkillProvider(
  inspection: SkillProviderImportInspection,
): boolean {
  const sourceFile = ts.createSourceFile(
    inspection.filePath,
    inspection.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let providerImport = false;
  const visit = (node: ts.Node): void => {
    if (runtimeModuleSpecifier(node).includes('.agents/skills/')) {
      providerImport = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return providerImport;
}

function runtimeModuleSpecifier(node: ts.Node): string {
  if (ts.isImportDeclaration(node)) {
    return isTypeOnlyImport(node) ? '' : literalText(node.moduleSpecifier);
  }
  if (ts.isExportDeclaration(node)) {
    return isTypeOnlyExport(node) || !node.moduleSpecifier
      ? ''
      : literalText(node.moduleSpecifier);
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    !node.isTypeOnly &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression
  ) {
    return literalText(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node) && isRuntimeLoader(node.expression)) {
    const moduleArgument = node.arguments[0];
    return moduleArgument ? literalText(moduleArgument) : '';
  }
  return '';
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings) return false;
  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return (
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function isRuntimeLoader(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'require')
  );
}

function literalText(expression: ts.Expression): string {
  return ts.isStringLiteralLike(expression) ? expression.text : '';
}

test('recognizes static and dynamic skill-provider runtime imports', () => {
  const runtimeImports = [
    "import provider from '../../../.agents/skills/provider/src/runner.ts';",
    "import '../../../.agents/skills/provider/src/runner.ts';",
    "export { provider } from '../../../.agents/skills/provider/src/runner.ts';",
    "export * from '../../../.agents/skills/provider/src/runner.ts';",
    "import provider = require('../../../.agents/skills/provider/src/runner.ts');",
    "await import('../../../.agents/skills/provider/src/runner.ts');",
    'await import(`../../../.agents/skills/provider/src/runner.ts`);',
    "require('../../../.agents/skills/provider/src/runner.ts');",
    "import {} from '../../../.agents/skills/provider/src/runner.ts';",
    "export {} from '../../../.agents/skills/provider/src/runner.ts';",
  ];

  for (const runtimeImport of runtimeImports) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'runtime-import.ts',
      source: runtimeImport,
    };
    expect(importsSkillProvider(inspection)).toBe(true);
  }
  for (const inertSource of [
    "const path = '.agents/skills/provider';",
    "import type { Provider } from '../../../.agents/skills/provider/src/domain.ts';",
    "export type { Provider } from '../../../.agents/skills/provider/src/domain.ts';",
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'inert-source.ts',
      source: inertSource,
    };
    expect(importsSkillProvider(inspection)).toBe(false);
  }
});

test('production Loom does not runtime-import dormant skill providers', async () => {
  const sourceGlob = new Bun.Glob('src/**/*.{js,ts}');
  const scanOptions: LoomSourceScanOptions = {
    cwd: LOOM_ROOT,
    onlyFiles: true,
  };
  const violations: string[] = [];

  for await (const relativePath of sourceGlob.scan(scanOptions)) {
    const source = await Bun.file(join(LOOM_ROOT, relativePath)).text();
    const inspection: SkillProviderImportInspection = {
      filePath: relativePath,
      source,
    };
    if (importsSkillProvider(inspection)) {
      violations.push(relativePath);
    }
  }

  expect(violations).toEqual([]);
});
