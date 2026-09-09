import {
  CortexMarkdownSyntaxAudit,
  CortexMarkdownSource,
} from './cortex-document-structure.ts';
import {
  CortexStructureFindingCode,
  type CortexDocumentSource,
  type CortexStructureFinding,
  CortexDocumentStructure,
} from './cortex-document-structure.ts';

import type { AuditCortexDocumentMapRequest } from './domain.ts';

export class CortexDocumentMapAudit {
  private constructor(
    private readonly request: AuditCortexDocumentMapRequest,
  ) {}

  static from(request: AuditCortexDocumentMapRequest): CortexDocumentMapAudit {
    return new CortexDocumentMapAudit(request);
  }

  public execute(): CortexStructureFinding[] {
    const request = this.request;
    const rawDocuments = request.documents.map((value) =>
      this.toDocumentSource(value),
    );
    const syntaxFindings = new CortexMarkdownSyntaxAudit({
      documents: rawDocuments,
    }).execute();
    const invalidSyntaxPaths = new Set(
      syntaxFindings
        .filter(
          (finding) =>
            finding.code === CortexStructureFindingCode.ProhibitedHtml,
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
        content: new CortexMarkdownSource(document).normalized(),
      }));
    const structureFindings = CortexDocumentStructure.from({
      documents: structureDocuments,
      excludedDocumentPaths: invalidSyntaxPaths,
      repoRoot: '.',
    }).execute();
    return [...syntaxFindings, ...structureFindings];
  }

  private toDocumentSource(
    document: AuditCortexDocumentMapRequest['documents'][number],
  ): CortexDocumentSource {
    return {
      absolutePath: document.relativePath,
      relativePath: document.relativePath,
      content: document.content,
    };
  }
}
