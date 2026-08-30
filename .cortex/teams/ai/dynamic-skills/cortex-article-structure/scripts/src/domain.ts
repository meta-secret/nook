export enum CortexArticleFindingCode {
  EmptyArticle = 'empty-article',
  DenseArticle = 'dense-article',
  UnorderedProcedure = 'unordered-procedure',
}

export enum CortexArticleContractKind {
  Request = 'cortex-article-structure-audit-v1',
  Result = 'cortex-article-structure-findings-v1',
}

export enum CortexArticleSemanticKind {
  Heading = 'heading',
  Paragraph = 'paragraph',
  VisibleOrderedList = 'visible-ordered-list',
  Structure = 'structure',
  Transparent = 'transparent',
  DensitySeparator = 'density-separator',
}

export const CORTEX_ARTICLE_DETAIL_TEXT_LIMIT = 3_800;
export const CORTEX_ARTICLE_DOCUMENT_LIMIT = 10_000;
export const CORTEX_ARTICLE_BLOCK_LIMIT = 100_000;
export const CORTEX_ARTICLE_HEADING_DEPTH_LIMIT = 6;
export const CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT = 4_096;
export const CORTEX_ARTICLE_FINDING_LIMIT = 50_000;
export const CORTEX_ARTICLE_PATH_LIMIT = 4_096;
export const CORTEX_ARTICLE_REQUEST_BYTE_LIMIT = 4 * 1_024 * 1_024;
export const CORTEX_ARTICLE_RESULT_BYTE_LIMIT = 1_024 * 1_024;

export type CortexArticleFinding = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type CortexArticleHeading = {
  readonly depth: number;
  readonly kind: CortexArticleSemanticKind.Heading;
  readonly line: number;
  readonly text: string;
};

export type CortexArticleSemanticBlock =
  | CortexArticleHeading
  | {
      readonly kind:
        | CortexArticleSemanticKind.Paragraph
        | CortexArticleSemanticKind.VisibleOrderedList
        | CortexArticleSemanticKind.Structure
        | CortexArticleSemanticKind.Transparent
        | CortexArticleSemanticKind.DensitySeparator;
      readonly line: number;
    };

export type CortexArticleDocument = {
  readonly relativePath: string;
  readonly blocks: readonly CortexArticleSemanticBlock[];
};

export type AuditCortexArticleStructureRequest = {
  readonly kind: CortexArticleContractKind.Request;
  readonly documents: readonly CortexArticleDocument[];
};

export type CortexArticleStructureResult = {
  readonly kind: CortexArticleContractKind.Result;
  readonly findings: readonly CortexArticleFinding[];
};
