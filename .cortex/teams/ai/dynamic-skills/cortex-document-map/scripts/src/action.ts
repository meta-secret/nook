import {
  CortexDocumentMapContractKind,
  CORTEX_DOCUMENT_MAP_CONTENT_LIMIT,
  CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT,
  CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT,
  CORTEX_DOCUMENT_MAP_PATH_LIMIT,
  CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT,
  CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT,
} from './domain.ts';
import {
  CortexDocumentMapRequestDecodeError,
  decodeCortexDocumentMapRequest,
} from './codec.ts';
import { executeCortexDocumentMapApplication } from './application.ts';

export const CORTEX_DOCUMENT_MAP_AUDIT_EXAMPLE = `cortexDocumentMap:
  audit:
    kind: cortex-document-map-audit-v1
    documents:
      - relativePath: .cortex/knowledge-graph.md
        content: |-
          # Cortex Context Router
    excludedDocumentPaths: []
`;

const CORTEX_PATH_PATTERN =
  '^\\.cortex/(?!\\.\\.?/)(?!.*\\/\\.\\.?(?:\\/|$))(?!.*\\\\)(?!.*[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e-\\u200f\\u2028-\\u202e\\u2066-\\u206f])[^/]+(?:/[^/]+)*\\.md$';
function cortexPathSchema() {
  return {
    type: 'string',
    maxUtf16CodeUnits: CORTEX_DOCUMENT_MAP_PATH_LIMIT,
    pattern: CORTEX_PATH_PATTERN,
  } as const;
}
export const CORTEX_DOCUMENT_MAP_AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  maximumRequestBytes: CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT,
  required: ['kind', 'documents', 'excludedDocumentPaths'],
  properties: {
    kind: {
      type: 'string',
      enum: [CortexDocumentMapContractKind.Request],
    },
    documents: {
      type: 'array',
      maxItems: CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['relativePath', 'content'],
        properties: {
          relativePath: cortexPathSchema(),
          content: {
            type: 'string',
            maxUtf16CodeUnits: CORTEX_DOCUMENT_MAP_CONTENT_LIMIT,
            pattern:
              '^(?![\\s\\S]*[\\u0000\\u007f-\\u009f\\u061c\\u200e-\\u200f\\u2028-\\u202e\\u2066-\\u206f])[\\s\\S]*$',
          },
        },
      },
    },
    excludedDocumentPaths: {
      type: 'array',
      maxItems: CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT,
      items: cortexPathSchema(),
    },
  },
} as const;

export const CORTEX_DOCUMENT_MAP_ACTION_DEFINITION = Object.freeze({
  skillId: 'cortex-document-map',
  family: 'cortexDocumentMap',
  operation: 'audit',
  description: 'Audit Cortex Markdown and owning knowledge-graph topology.',
  exampleRequest: "task skills:run REQUEST_YAML='<strict-yaml>'",
  exampleYaml: CORTEX_DOCUMENT_MAP_AUDIT_EXAMPLE,
  resolvedExampleYaml: CORTEX_DOCUMENT_MAP_AUDIT_EXAMPLE,
  inputSchema: CORTEX_DOCUMENT_MAP_AUDIT_SCHEMA,
});

export function decodeCortexDocumentMapActionPayload(serialized: string) {
  return decodeCortexDocumentMapRequest(serialized);
}

export const executeCortexDocumentMapAction =
  executeCortexDocumentMapApplication;
export { CortexDocumentMapRequestDecodeError };
