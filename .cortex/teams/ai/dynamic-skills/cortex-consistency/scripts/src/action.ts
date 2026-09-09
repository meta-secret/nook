import { CortexConsistencyApplication } from './application.ts';
import { CortexConsistencyRequestDecoder } from './codec.ts';
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

class CortexReferenceSchema {
  private static readonly maximumCodeUnits = CORTEX_CONSISTENCY_PATH_LIMIT;
  static create() {
    return {
      type: 'string',
      maxUtf16CodeUnits: CortexReferenceSchema.maximumCodeUnits,
      pattern:
        '^(?!.*[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e-\\u200f\\u2028-\\u202e\\u2066-\\u206f])[\\s\\S]*$',
    } as const;
  }
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
          relativePath: CortexReferenceSchema.create(),
          references: {
            type: 'array',
            maxItems: CORTEX_CONSISTENCY_REFERENCE_LIMIT,
            items: CortexReferenceSchema.create(),
          },
          commands: {
            type: 'array',
            maxItems: CORTEX_CONSISTENCY_REFERENCE_LIMIT,
            items: CortexReferenceSchema.create(),
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

export const decodeCortexConsistencyActionPayload = (
  request: Parameters<typeof CortexConsistencyRequestDecoder.from>[0],
) => CortexConsistencyRequestDecoder.from(request).execute();
export const executeCortexConsistencyAction = (
  request: Parameters<typeof CortexConsistencyApplication.from>[0],
) => CortexConsistencyApplication.from(request).execute();
export { CortexConsistencyRequestDecodeError } from './codec.ts';
