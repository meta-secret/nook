import ts from 'typescript';
import { analyzeExecutableSkillSource } from '../src/executable-skills/source-policy.ts';

export type CortexArticleAdapterInspection = {
  readonly path: string;
  readonly source: string;
};

type EraseNodeRequest = {
  readonly node: ts.Node;
  readonly target: string[];
};

const APPLICATION_IMPORT =
  '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/application.ts';
const DOMAIN_IMPORT =
  '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/domain.ts';
const DOCUMENT_SOURCE_IMPORT =
  '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';
const CONSISTENCY_APPLICATION_IMPORT =
  '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/application.ts';
const CONSISTENCY_DOMAIN_IMPORT =
  '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';
const CONSISTENCY_REGISTRY_IMPORT =
  '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/registry.ts';
const FORBIDDEN_ADAPTER_GLOBALS = new Set([
  'Bun',
  'Deno',
  'XMLHttpRequest',
  'navigator',
]);

export function cortexArticleAdapterViolatesBoundary(
  inspection: CortexArticleAdapterInspection,
): boolean {
  const sourceFile = ts.createSourceFile(
    inspection.path,
    inspection.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const retained = [...inspection.source];
  let invalid = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!isAllowedImport(node)) invalid = true;
      else {
        const eraseRequest: EraseNodeRequest = { node, target: retained };
        eraseNode(eraseRequest);
      }
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!isAllowedExport(node)) invalid = true;
      else {
        const eraseRequest: EraseNodeRequest = { node, target: retained };
        eraseNode(eraseRequest);
      }
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))) ||
      (ts.isIdentifier(node) && FORBIDDEN_ADAPTER_GLOBALS.has(node.text))
    ) {
      invalid = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (invalid) return true;
  const analysisRequest = {
    relativePath:
      '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/adapter.ts',
    source: retained.join(''),
  };
  try {
    analyzeExecutableSkillSource(analysisRequest);
    return false;
  } catch {
    return true;
  }
}

function isAllowedImport(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier) || node.attributes)
    return false;
  const specifier = node.moduleSpecifier.text;
  const clause = node.importClause;
  if (!clause) return false;
  if (specifier === 'node:fs') {
    return (
      !clause.name &&
      !clause.isTypeOnly &&
      Boolean(
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 &&
        clause.namedBindings.elements.every(
          (element) =>
            !element.isTypeOnly &&
            (element.propertyName ?? element.name).text === 'readFileSync',
        ),
      )
    );
  }
  if (specifier === 'mdast') return clause.isTypeOnly;
  if (specifier === 'remark-gfm' || specifier === 'remark-parse') {
    return Boolean(clause.name && !clause.namedBindings && !clause.isTypeOnly);
  }
  if (specifier === 'unified') {
    return Boolean(
      !clause.name &&
      !clause.isTypeOnly &&
      clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length === 1 &&
      (
        clause.namedBindings.elements[0]?.propertyName ??
        clause.namedBindings.elements[0]?.name
      )?.text === 'unified',
    );
  }
  if (specifier === DOCUMENT_SOURCE_IMPORT) return clause.isTypeOnly;
  return (
    specifier === APPLICATION_IMPORT ||
    specifier === DOMAIN_IMPORT ||
    specifier === CONSISTENCY_APPLICATION_IMPORT ||
    specifier === CONSISTENCY_DOMAIN_IMPORT ||
    specifier === CONSISTENCY_REGISTRY_IMPORT
  );
}

function isAllowedExport(node: ts.ExportDeclaration): boolean {
  const specifier = node.moduleSpecifier;
  return (
    Boolean(
      specifier &&
      ts.isStringLiteral(specifier) &&
      [
        DOMAIN_IMPORT,
        CONSISTENCY_DOMAIN_IMPORT,
        CONSISTENCY_REGISTRY_IMPORT,
      ].includes(specifier.text),
    ) &&
    Boolean(node.exportClause && ts.isNamedExports(node.exportClause)) &&
    !node.attributes
  );
}

function eraseNode(request: EraseNodeRequest): void {
  request.target.fill(' ', request.node.getFullStart(), request.node.getEnd());
}
