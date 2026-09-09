import { CortexArticleAudit } from '../src/audit.ts';

import {
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
} from '../src/domain.ts';

export class CortexArticleStructureSupportScenario {
  private constructor(private readonly request: MakeDocumentRequest) {}

  static makeDocument(request: MakeDocumentRequest): CortexArticleDocument {
    return new CortexArticleStructureSupportScenario(request).execute();
  }

  private execute(): CortexArticleDocument {
    const request = this.request;
    return {
      relativePath: request.relativePath,
      blocks: request.blocks,
    };
  }

  static makeAuditRequest(
    request: MakeAuditRequest,
  ): AuditCortexArticleStructureRequest {
    return {
      kind: CortexArticleContractKind.Request,
      documents: request.documents,
    };
  }

  static audit(request: MakeAuditRequest): CortexArticleFinding[] {
    return CortexArticleAudit.from(
      CortexArticleStructureSupportScenario.makeAuditRequest(request),
    ).execute();
  }
}

export type MakeAuditRequest = {
  readonly documents: readonly CortexArticleDocument[];
};

export type MakeDocumentRequest = {
  readonly blocks: readonly CortexArticleSemanticBlock[];
  readonly relativePath: string;
};
