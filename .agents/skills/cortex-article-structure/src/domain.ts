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

export enum CortexArticleBlockKind {
  Definition = 'definition',
  Heading = 'heading',
  Html = 'html',
  List = 'list',
  Paragraph = 'paragraph',
  Structure = 'structure',
}

export const CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT = 4096;
export const CORTEX_ARTICLE_FINDING_LIMIT = 50_000;
export const CORTEX_ARTICLE_HEADING_TEXT_LIMIT =
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT;

export type CortexArticleFinding = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type CortexArticleHeadingBlock = {
  readonly depth: number;
  readonly line: number;
  readonly text: string;
  readonly type: CortexArticleBlockKind.Heading;
};

export type CortexArticleBlock =
  | CortexArticleHeadingBlock
  | {
      readonly line: number;
      readonly type:
        | CortexArticleBlockKind.Paragraph
        | CortexArticleBlockKind.Definition
        | CortexArticleBlockKind.Structure;
    }
  | {
      readonly line: number;
      readonly ordered: boolean;
      readonly type: CortexArticleBlockKind.List;
    }
  | {
      readonly comment: boolean;
      readonly line: number;
      readonly type: CortexArticleBlockKind.Html;
    };

export type CortexArticleDocument = {
  readonly relativePath: string;
  readonly blocks: readonly CortexArticleBlock[];
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
