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
  '../../../skills/cortex-article-structure/src/application.ts';
const DOMAIN_IMPORT = '../../../skills/cortex-article-structure/src/domain.ts';
const LOCAL_TYPE_IMPORT = './cortex-document-structure.ts';
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
    relativePath: 'agentic-ai/skills/cortex-article-adapter/src/adapter.ts',
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
  if (specifier === LOCAL_TYPE_IMPORT) return clause.isTypeOnly;
  return specifier === APPLICATION_IMPORT || specifier === DOMAIN_IMPORT;
}

function isAllowedExport(node: ts.ExportDeclaration): boolean {
  const specifier = node.moduleSpecifier;
  return (
    Boolean(
      specifier &&
      ts.isStringLiteral(specifier) &&
      specifier.text === DOMAIN_IMPORT,
    ) &&
    Boolean(node.exportClause && ts.isNamedExports(node.exportClause)) &&
    !node.attributes
  );
}

function eraseNode(request: EraseNodeRequest): void {
  request.target.fill(' ', request.node.getFullStart(), request.node.getEnd());
}
