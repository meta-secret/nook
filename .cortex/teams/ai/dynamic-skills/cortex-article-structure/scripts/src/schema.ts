import { z } from 'zod';
import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_BLOCK_LIMIT,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_DOCUMENT_LIMIT,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_HEADING_DEPTH_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
} from './vocabulary.ts';

// Zod is pinned to 4.4.3: its string .max() reads JavaScript UTF-16 length.
// Keep this wire contract when changing the validator version.
export const CORTEX_ARTICLE_SAFE_PATH_SCHEMA = z
  .string()
  .regex(/\S/u)
  .regex(
    /^(?!\/)(?!.*\\)(?!.*[\u0000-\u001f\u007f])(?!\.\.?(?:\/|$))(?!.*\/\.\.?(?:\/|$))[^/]+(?:\/[^/]+)*$/su,
  )
  .max(CORTEX_ARTICLE_PATH_LIMIT);

export const CORTEX_ARTICLE_MARKDOWN_PATH_SCHEMA =
  CORTEX_ARTICLE_SAFE_PATH_SCHEMA.startsWith('.cortex/').endsWith('.md');

export const CORTEX_ARTICLE_LINE_SCHEMA = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const CORTEX_ARTICLE_HEADING_SCHEMA = z.strictObject({
  depth: z.number().int().min(1).max(CORTEX_ARTICLE_HEADING_DEPTH_LIMIT),
  kind: z.literal(CortexArticleSemanticKind.Heading),
  line: CORTEX_ARTICLE_LINE_SCHEMA,
  text: z.string().max(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT),
});

export const CORTEX_ARTICLE_SIMPLE_KIND_SCHEMA = z
  .enum(CortexArticleSemanticKind)
  // Zod enum exclusions use declaration keys, not their serialized values.
  .exclude(['Heading']);

export const CORTEX_ARTICLE_SIMPLE_BLOCK_SCHEMA = z.strictObject({
  kind: CORTEX_ARTICLE_SIMPLE_KIND_SCHEMA,
  line: CORTEX_ARTICLE_LINE_SCHEMA,
});

export const CORTEX_ARTICLE_BLOCK_SCHEMA = z.discriminatedUnion('kind', [
  CORTEX_ARTICLE_HEADING_SCHEMA,
  CORTEX_ARTICLE_SIMPLE_BLOCK_SCHEMA,
]);

export const CORTEX_ARTICLE_DOCUMENT_SCHEMA = z.strictObject({
  relativePath: CORTEX_ARTICLE_MARKDOWN_PATH_SCHEMA,
  blocks: z.array(CORTEX_ARTICLE_BLOCK_SCHEMA).max(CORTEX_ARTICLE_BLOCK_LIMIT),
});

export const CORTEX_ARTICLE_REQUEST_SCHEMA = z.strictObject({
  kind: z.literal(CortexArticleContractKind.Request),
  documents: z
    .array(CORTEX_ARTICLE_DOCUMENT_SCHEMA)
    .max(CORTEX_ARTICLE_DOCUMENT_LIMIT),
});

export const CORTEX_ARTICLE_FINDING_SCHEMA = z.strictObject({
  code: z.enum(CortexArticleFindingCode),
  file: CORTEX_ARTICLE_SAFE_PATH_SCHEMA,
  line: CORTEX_ARTICLE_LINE_SCHEMA,
  message: z.string().regex(/\S/u).max(CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT),
});

export const CORTEX_ARTICLE_RESULT_SCHEMA = z.strictObject({
  kind: z.literal(CortexArticleContractKind.Result),
  findings: z
    .array(CORTEX_ARTICLE_FINDING_SCHEMA)
    .max(CORTEX_ARTICLE_FINDING_LIMIT),
});

// These private-edge stages preserve the established first-failure contract.
// Leaf records are admitted by the canonical schemas before leaving the codec.
export const CORTEX_ARTICLE_REQUEST_ENVELOPE_SCHEMA =
  CORTEX_ARTICLE_REQUEST_SCHEMA.extend({
    documents: z.array(z.unknown()).max(CORTEX_ARTICLE_DOCUMENT_LIMIT),
  });
export const CORTEX_ARTICLE_DOCUMENT_ENVELOPE_SCHEMA =
  CORTEX_ARTICLE_DOCUMENT_SCHEMA.extend({
    blocks: z.array(z.unknown()).max(CORTEX_ARTICLE_BLOCK_LIMIT),
  });
export const CORTEX_ARTICLE_RESULT_ENVELOPE_SCHEMA =
  CORTEX_ARTICLE_RESULT_SCHEMA.extend({
    findings: z.array(z.unknown()).max(CORTEX_ARTICLE_FINDING_LIMIT),
  });
export const CORTEX_ARTICLE_BLOCK_LINE_SCHEMA = z.looseObject({
  line: CORTEX_ARTICLE_LINE_SCHEMA,
});
