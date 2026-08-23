export enum CortexArticleFindingCode {
  InvalidMigrationLedger = 'invalid-article-migration-ledger',
  EmptyArticle = 'empty-article',
  DenseArticle = 'dense-article',
  UnorderedProcedure = 'unordered-procedure',
}

export enum CortexArticleFindingMessage {
  DenseArticle = 'Article has more than 3 consecutive prose blocks without visible structure.',
  DuplicateMigrationEntry = 'Duplicate article-structure migration exemption.',
  EmptyArticle = 'Article has no body content.',
  PostBaselineMigrationEntry = 'Article-structure exemption was added after the baseline.',
  UncatalogedMigrationEntry = 'Article-structure exemption is not a Cortex Markdown file.',
  UnorderedProcedure = 'Procedure-like article must expose its action sequence as an ordered list.',
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
  Separator = 'separator',
  Structure = 'structure',
}

export const CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT = 4096;
export const CORTEX_ARTICLE_FINDING_LIMIT = 50_000;
export const CORTEX_ARTICLE_HEADING_TEXT_LIMIT =
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT;
export const CORTEX_ARTICLE_REQUEST_BYTE_LIMIT = 4 * 1024 * 1024;
export const CORTEX_ARTICLE_RESULT_BYTE_LIMIT = 1024 * 1024;

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
        | CortexArticleBlockKind.Separator
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
