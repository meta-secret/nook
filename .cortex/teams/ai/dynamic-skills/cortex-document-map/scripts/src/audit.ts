import {
  auditCortexDocumentStructure,
  auditCortexMarkdownSyntax,
  CortexStructureFindingCode,
  normalizedCortexMarkdown,
  type CortexDocumentSource,
  type CortexStructureFinding,
} from './cortex-document-structure.ts';
import type { AuditCortexDocumentMapRequest } from './domain.ts';

export function auditCortexDocumentMap(
  request: AuditCortexDocumentMapRequest,
): CortexStructureFinding[] {
  const rawDocuments = request.documents.map(toDocumentSource);
  const syntaxFindings = auditCortexMarkdownSyntax({ documents: rawDocuments });
  const invalidSyntaxPaths = new Set(
    syntaxFindings
      .filter(
        (finding) => finding.code === CortexStructureFindingCode.ProhibitedHtml,
      )
      .map((finding) => finding.file),
  );
  const omittedFromTopology = new Set([
    ...request.excludedDocumentPaths,
    ...invalidSyntaxPaths,
  ]);
  const structureDocuments = rawDocuments
    .filter((document) => !omittedFromTopology.has(document.relativePath))
    .map((document) => ({
      ...document,
      content: normalizedCortexMarkdown(document),
    }));
  const structureFindings = auditCortexDocumentStructure({
    documents: structureDocuments,
    excludedDocumentPaths: invalidSyntaxPaths,
    repoRoot: '.',
  });
  return [...syntaxFindings, ...structureFindings];
}

function toDocumentSource(
  document: AuditCortexDocumentMapRequest['documents'][number],
): CortexDocumentSource {
  return {
    absolutePath: document.relativePath,
    relativePath: document.relativePath,
    content: document.content,
  };
}
