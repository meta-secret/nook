import type { z } from 'zod';
import type {
  CORTEX_ARTICLE_FINDING_SCHEMA,
  CORTEX_ARTICLE_HEADING_SCHEMA,
  CORTEX_ARTICLE_BLOCK_SCHEMA,
  CORTEX_ARTICLE_DOCUMENT_SCHEMA,
  CORTEX_ARTICLE_REQUEST_SCHEMA,
  CORTEX_ARTICLE_RESULT_SCHEMA,
} from './schema.ts';
export * from './vocabulary.ts';

export type CortexArticleFinding = Readonly<
  z.infer<typeof CORTEX_ARTICLE_FINDING_SCHEMA>
>;
export type CortexArticleHeading = Readonly<
  z.infer<typeof CORTEX_ARTICLE_HEADING_SCHEMA>
>;
export type CortexArticleSemanticBlock = Readonly<
  z.infer<typeof CORTEX_ARTICLE_BLOCK_SCHEMA>
>;

export type CortexArticleDocument = Readonly<
  Omit<z.infer<typeof CORTEX_ARTICLE_DOCUMENT_SCHEMA>, 'blocks'> & {
    blocks: readonly CortexArticleSemanticBlock[];
  }
>;
export type AuditCortexArticleStructureRequest = Readonly<
  Omit<z.infer<typeof CORTEX_ARTICLE_REQUEST_SCHEMA>, 'documents'> & {
    documents: readonly CortexArticleDocument[];
  }
>;
export type CortexArticleStructureResult = Readonly<
  Omit<z.infer<typeof CORTEX_ARTICLE_RESULT_SCHEMA>, 'findings'> & {
    findings: readonly CortexArticleFinding[];
  }
>;
