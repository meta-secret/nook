import { executeDelegationVisualizationApplication } from './application.ts';
import {
  decodeDelegationVisualizationRequest,
  DelegationVisualizationRequestDecodeError,
} from './codec.ts';
import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
  DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT,
  DELEGATION_VISUALIZATION_ID_LIMIT,
  DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT,
  DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT,
  DELEGATION_VISUALIZATION_TASK_LIMIT,
} from './domain.ts';

export const DELEGATION_VISUALIZATION_RENDER_EXAMPLE = `delegationVisualization:
  render:
    kind: gizmo-delegation-visualization-v1
    tasks:
      - id: update-cortex
        team: ai
        description: update Cortex
        dependencies: []
      - id: create-security-key
        team: web-development
        description: create security key component
        dependencies:
          - update-cortex
`;

function identifierSchema() {
  return {
    type: 'string',
    maxUtf16CodeUnits: DELEGATION_VISUALIZATION_ID_LIMIT,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
  } as const;
}

export const DELEGATION_VISUALIZATION_RENDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  maximumRequestBytes: DELEGATION_VISUALIZATION_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: DELEGATION_VISUALIZATION_RESULT_BYTE_LIMIT,
  required: ['kind', 'tasks'],
  properties: {
    kind: {
      type: 'string',
      enum: [DelegationVisualizationContractKind.Request],
    },
    tasks: {
      type: 'array',
      maxItems: DELEGATION_VISUALIZATION_TASK_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'team', 'description', 'dependencies'],
        properties: {
          id: identifierSchema(),
          team: {
            type: 'string',
            enum: Object.values(DelegationVisualizationTeam),
          },
          description: {
            type: 'string',
            maxUtf16CodeUnits: DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT,
            maxTrimmedLines: 1,
            maxTrimmedLineUtf16CodeUnits:
              DELEGATION_VISUALIZATION_DESCRIPTION_LIMIT,
          },
          dependencies: {
            type: 'array',
            maxItems: DELEGATION_VISUALIZATION_TASK_LIMIT,
            items: identifierSchema(),
          },
        },
      },
    },
  },
} as const;

export const DELEGATION_VISUALIZATION_ACTION_DEFINITION = Object.freeze({
  skillId: 'delegation-visualization',
  family: 'delegationVisualization',
  operation: 'render',
  description: 'Render an ordered native Team Agent plan beneath Gizmo.',
  exampleRequest: "task skills:run REQUEST_YAML='<strict-yaml>'",
  exampleYaml: DELEGATION_VISUALIZATION_RENDER_EXAMPLE,
  resolvedExampleYaml: DELEGATION_VISUALIZATION_RENDER_EXAMPLE,
  inputSchema: DELEGATION_VISUALIZATION_RENDER_SCHEMA,
} as const);

export const decodeDelegationVisualizationActionPayload =
  decodeDelegationVisualizationRequest;
export const executeDelegationVisualizationAction =
  executeDelegationVisualizationApplication;
export { DelegationVisualizationRequestDecodeError };
