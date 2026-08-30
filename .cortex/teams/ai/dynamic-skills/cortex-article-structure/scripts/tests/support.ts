import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
} from '../src/domain.ts';

export type MakeAuditRequest = {
  readonly documents: readonly CortexArticleDocument[];
};

export type MakeDocumentRequest = {
  readonly blocks: readonly CortexArticleSemanticBlock[];
  readonly relativePath: string;
};

export function makeDocument(
  request: MakeDocumentRequest,
): CortexArticleDocument {
  return {
    relativePath: request.relativePath,
    blocks: request.blocks,
  };
}

export function makeAuditRequest(
  request: MakeAuditRequest,
): AuditCortexArticleStructureRequest {
  return {
    kind: CortexArticleContractKind.Request,
    documents: request.documents,
  };
}

export function audit(request: MakeAuditRequest): CortexArticleFinding[] {
  return auditCortexArticleStructure(makeAuditRequest(request));
}
