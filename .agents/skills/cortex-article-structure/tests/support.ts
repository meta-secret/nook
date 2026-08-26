import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  CortexArticleContractKind,
  CORTEX_ARTICLE_MIGRATION_LEDGER_PATH,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
} from '../src/domain.ts';

export type MakeAuditRequest = {
  readonly documents: readonly CortexArticleDocument[];
  readonly migrationBaselineEntries?: readonly string[] | false;
  readonly migrationLedgerContent?: string | false;
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
    migrationBaselineEntries: request.migrationBaselineEntries ?? false,
    migrationLedger: {
      relativePath: CORTEX_ARTICLE_MIGRATION_LEDGER_PATH,
      content: request.migrationLedgerContent ?? false,
    },
  };
}

export function audit(request: MakeAuditRequest): CortexArticleFinding[] {
  return auditCortexArticleStructure(makeAuditRequest(request));
}
