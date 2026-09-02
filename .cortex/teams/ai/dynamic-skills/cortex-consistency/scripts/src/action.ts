import { executeCortexConsistencyApplication } from './application.ts';
import { decodeCortexConsistencyRequest } from './codec.ts';
import {
  CortexConsistencyContractKind,
  CORTEX_CONSISTENCY_DOCUMENT_LIMIT,
  CORTEX_CONSISTENCY_PATH_LIMIT,
  CORTEX_CONSISTENCY_REFERENCE_LIMIT,
  CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT,
  CORTEX_CONSISTENCY_RESULT_BYTE_LIMIT,
} from './domain.ts';

export const CORTEX_CONSISTENCY_COMPILE_EXAMPLE = `cortexConsistency:
  compile:
    kind: cortex-consistency-compile-v2
    documents:
      - relativePath: .cortex/AGENTS.md
        references:
          - teams/ai/dynamic-skills/cortex-consistency/SKILL.md
        commands: []
`;

function referenceSchema() {
  return {
    type: 'string',
    maxUtf16CodeUnits: CORTEX_CONSISTENCY_PATH_LIMIT,
    pattern:
      '^(?!.*[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e-\\u200f\\u2028-\\u202e\\u2066-\\u206f])[\\s\\S]*$',
  } as const;
}

export const CORTEX_CONSISTENCY_COMPILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  maximumRequestBytes: CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: CORTEX_CONSISTENCY_RESULT_BYTE_LIMIT,
  required: ['kind', 'documents'],
  properties: {
    kind: {
      type: 'string',
      enum: [CortexConsistencyContractKind.Request],
    },
    documents: {
      type: 'array',
      maxItems: CORTEX_CONSISTENCY_DOCUMENT_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['relativePath', 'references', 'commands'],
        properties: {
          relativePath: referenceSchema(),
          references: {
            type: 'array',
            maxItems: CORTEX_CONSISTENCY_REFERENCE_LIMIT,
            items: referenceSchema(),
          },
          commands: {
            type: 'array',
            maxItems: CORTEX_CONSISTENCY_REFERENCE_LIMIT,
            items: referenceSchema(),
          },
        },
      },
    },
  },
} as const;

export const CORTEX_CONSISTENCY_ACTION_DEFINITION = Object.freeze({
  skillId: 'cortex-consistency',
  family: 'cortexConsistency',
  operation: 'compile',
  description: 'Compile typed Cortex consistency contracts.',
  exampleRequest: "task skills:run REQUEST_YAML='<strict-yaml>'",
  exampleYaml: CORTEX_CONSISTENCY_COMPILE_EXAMPLE,
  resolvedExampleYaml: CORTEX_CONSISTENCY_COMPILE_EXAMPLE,
  inputSchema: CORTEX_CONSISTENCY_COMPILE_SCHEMA,
} as const);

export const decodeCortexConsistencyActionPayload =
  decodeCortexConsistencyRequest;
export const executeCortexConsistencyAction =
  executeCortexConsistencyApplication;
export { CortexConsistencyRequestDecodeError } from './codec.ts';
