import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_BLOCK_LIMIT,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_DOCUMENT_LIMIT,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_HEADING_DEPTH_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
} from './domain.ts';
import {
  CortexArticleRequestDecodeError,
  decodeCortexArticleRequest,
} from './codec.ts';
import { executeCortexArticleStructureApplication } from './application.ts';
export const CORTEX_ARTICLE_AUDIT_EXAMPLE = `cortexArticleStructure:
  audit:
    kind: cortex-article-structure-audit-v1
    documents:
      - relativePath: .cortex/example.md
        blocks:
          - depth: 2
            kind: heading
            line: 1
            text: Overview
          - kind: paragraph
            line: 3
    migrationBaselineEntries: false
    migrationLedger:
      relativePath: .cortex/article-structure-migration.txt
      content: false
`;
const POSITIVE_SOURCE_LINE_SCHEMA = {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const CORTEX_MARKDOWN_PATH_SCHEMA = {
  type: 'string',
  maxLength: CORTEX_ARTICLE_PATH_LIMIT,
  pattern:
    '^\\.cortex/(?!\\.\\.?/)(?!.*/\\.\\.?(?:/|$))(?!.*\\\\)(?!.*[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e-\\u200f\\u2028-\\u202e\\u2066-\\u206f])[^/]+(?:/[^/]+)*\\.md$',
} as const;
const HEADING_BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['depth', 'kind', 'line', 'text'],
  properties: {
    depth: {
      type: 'integer',
      minimum: 1,
      maximum: CORTEX_ARTICLE_HEADING_DEPTH_LIMIT,
    },
    kind: {
      type: 'string',
      enum: [CortexArticleSemanticKind.Heading],
    },
    line: POSITIVE_SOURCE_LINE_SCHEMA,
    text: {
      type: 'string',
      maxLength: CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
      pattern:
        '^(?!.*[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e-\\u200f\\u2028-\\u202e\\u2066-\\u206f])[\\s\\S]*$',
    },
  },
} as const;
const SIMPLE_BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'line'],
  properties: {
    kind: {
      type: 'string',
      enum: [
        CortexArticleSemanticKind.Paragraph,
        CortexArticleSemanticKind.VisibleOrderedList,
        CortexArticleSemanticKind.Structure,
        CortexArticleSemanticKind.Transparent,
        CortexArticleSemanticKind.DensitySeparator,
      ],
    },
    line: POSITIVE_SOURCE_LINE_SCHEMA,
  },
} as const;
const ARTICLE_DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relativePath', 'blocks'],
  properties: {
    relativePath: CORTEX_MARKDOWN_PATH_SCHEMA,
    blocks: {
      type: 'array',
      maxItems: CORTEX_ARTICLE_BLOCK_LIMIT,
      items: {
        oneOf: [HEADING_BLOCK_SCHEMA, SIMPLE_BLOCK_SCHEMA],
      },
    },
  },
} as const;
const MIGRATION_LEDGER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relativePath', 'content'],
  properties: {
    relativePath: {
      type: 'string',
      enum: ['.cortex/article-structure-migration.txt'],
    },
    content: { type: 'string' },
  },
} as const;
export const CORTEX_ARTICLE_AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  maximumRequestBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  derivedResultConstraints: {
    maximumBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
    maximumFindings: CORTEX_ARTICLE_FINDING_LIMIT,
    rule: 'The deterministic audit result derived from this request must fit both limits.',
  },
  required: [
    'kind',
    'documents',
    'migrationBaselineEntries',
    'migrationLedger',
  ],
  properties: {
    kind: {
      type: 'string',
      enum: [CortexArticleContractKind.Request],
    },
    documents: {
      type: 'array',
      maxItems: CORTEX_ARTICLE_DOCUMENT_LIMIT,
      items: ARTICLE_DOCUMENT_SCHEMA,
    },
    migrationBaselineEntries: {
      oneOf: [
        {
          type: 'array',
          maxItems: CORTEX_ARTICLE_DOCUMENT_LIMIT,
          items: CORTEX_MARKDOWN_PATH_SCHEMA,
        },
        { const: false },
      ],
    },
    migrationLedger: {
      ...MIGRATION_LEDGER_SCHEMA,
      properties: {
        ...MIGRATION_LEDGER_SCHEMA.properties,
        content: {
          oneOf: [
            {
              type: 'string',
              maxTrimmedLines: CORTEX_ARTICLE_FINDING_LIMIT,
              maxTrimmedLineLength: CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
            },
            { const: false },
          ],
        },
      },
    },
  },
} as const;
const CORTEX_ARTICLE_ACTION = {
  skillId: 'cortex-article-structure',
  family: 'cortexArticleStructure',
  operation: 'audit',
  description: 'Audit semantic structure in Cortex Markdown articles.',
  exampleRequest: 'Unavailable until repository invocation is authorized.',
  exampleYaml: CORTEX_ARTICLE_AUDIT_EXAMPLE,
  resolvedExampleYaml: CORTEX_ARTICLE_AUDIT_EXAMPLE,
  inputSchema: CORTEX_ARTICLE_AUDIT_SCHEMA,
} as const;
export const CORTEX_ARTICLE_ACTION_DEFINITION = Object.freeze(
  CORTEX_ARTICLE_ACTION,
);
export function decodeCortexArticleActionPayload(serialized: string) {
  return decodeCortexArticleRequest(serialized);
}
export const executeCortexArticleAction =
  executeCortexArticleStructureApplication;
export { CortexArticleRequestDecodeError };
export const CORTEX_ARTICLE_FINDING_CODES = Object.freeze(
  Object.values(CortexArticleFindingCode),
);
