export enum CortexArticleFindingCode {
  InvalidMigrationLedger = 'invalid-article-migration-ledger',
  EmptyArticle = 'empty-article',
  DenseArticle = 'dense-article',
  UnorderedProcedure = 'unordered-procedure',
}

export enum CortexArticleContractKind {
  Request = 'cortex-article-structure-audit-v1',
  Result = 'cortex-article-structure-findings-v1',
}

export type CortexArticleFinding = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type CortexArticleDocument = {
  readonly relativePath: string;
  readonly content: string;
};

export type CortexArticleMigrationLedger = {
  readonly relativePath: string;
  readonly content: string | false;
};

export type AuditCortexArticleStructureRequest = {
  readonly kind: CortexArticleContractKind.Request;
  readonly documents: readonly CortexArticleDocument[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedger: CortexArticleMigrationLedger;
};

export type CortexArticleStructureResult = {
  readonly kind: CortexArticleContractKind.Result;
  readonly findings: readonly CortexArticleFinding[];
};
