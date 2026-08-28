import {
  CortexArticleFindingCode,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type CortexArticleStructureResult,
} from '../../../cortex-article-structure/scripts/src/domain.ts';
import {
  CORTEX_ARTICLE_ACTION_DEFINITION,
  CortexArticleRequestDecodeError,
  decodeCortexArticleActionPayload,
  executeCortexArticleAction,
} from '../../../cortex-article-structure/scripts/src/action.ts';
import {
  CortexArticleStructureOperation,
  SkillRequestFamily,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  SkillSchemaType,
  SkillToolsOperation,
  type DiscoverableSkillAction,
  type SkillObjectSchema,
  type SkillToolsListResult,
} from './skill-command-domain.ts';
import {
  isSkillYamlMap,
  skillYamlProperty,
  type SkillYamlPropertyRequest,
  type UntrustedSkillYamlMap,
  type UntrustedSkillYamlNode,
} from './skill-yaml-codec.ts';
import {
  validateSkillInput,
  type SkillSchemaValidationRequest,
} from './skill-schema-validator.ts';
import { unknownSkillCommandPath } from './skill-command-path.ts';
export const SKILL_TOOLS_LIST_INVOKE = 'task skills:tools-list';
const TOOLS_LIST_EXAMPLE = `skillToolsList:
  list: {}
`;
const CORTEX_ARTICLE_AUDIT_EXAMPLE = `cortexArticleStructure:
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
const EMPTY_OBJECT_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: [],
  properties: {},
  maximumResponseBytes: SKILL_HOST_RESPONSE_BYTE_LIMIT,
};
const CORTEX_ARTICLE_DISCOVERY_SCHEMA: SkillObjectSchema = {
  ...CORTEX_ARTICLE_ACTION_DEFINITION.inputSchema,
  maximumResponseBytes: SKILL_HOST_RESPONSE_BYTE_LIMIT,
};
const DISCOVERABLE_ACTIONS: readonly DiscoverableSkillAction[] = [
  {
    skillId: 'skills',
    family: SkillRequestFamily.ToolsList,
    operation: SkillToolsOperation.List,
    description: 'List executable skill actions, YAML examples, and schemas.',
    exampleRequest: SKILL_TOOLS_LIST_INVOKE,
    exampleYaml: TOOLS_LIST_EXAMPLE,
    resolvedExampleYaml: TOOLS_LIST_EXAMPLE,
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    skillId: CORTEX_ARTICLE_ACTION_DEFINITION.skillId,
    family: SkillRequestFamily.CortexArticleStructure,
    operation: CortexArticleStructureOperation.Audit,
    description: CORTEX_ARTICLE_ACTION_DEFINITION.description,
    exampleRequest: CORTEX_ARTICLE_ACTION_DEFINITION.exampleRequest,
    exampleYaml: CORTEX_ARTICLE_ACTION_DEFINITION.exampleYaml,
    resolvedExampleYaml: CORTEX_ARTICLE_ACTION_DEFINITION.resolvedExampleYaml,
    inputSchema: CORTEX_ARTICLE_DISCOVERY_SCHEMA,
  },
];
export function listDiscoverableSkillActions(): SkillToolsListResult {
  return { actions: DISCOVERABLE_ACTIONS };
}
export type SkillActionRequest =
  | {
      readonly family: SkillRequestFamily.ToolsList;
      readonly operation: SkillToolsOperation.List;
    }
  | {
      readonly family: SkillRequestFamily.CortexArticleStructure;
      readonly operation: CortexArticleStructureOperation.Audit;
      readonly request: ReturnType<typeof decodeCortexArticleActionPayload>;
    };
export type SkillActionResult =
  SkillToolsListResult | CortexArticleStructureResult;
export type SkillActionDecodeOutcome =
  | { readonly ok: true; readonly request: SkillActionRequest }
  | { readonly ok: false; readonly path: string; readonly message: string };
export function decodeSkillActionRequest(
  value: UntrustedSkillYamlNode,
): SkillActionDecodeOutcome {
  if (!isSkillYamlMap(value) || Object.keys(value).length !== 1) {
    const request: InvalidSkillRequest = {
      path: '',
      message: 'Expected exactly one skill request family.',
    };
    return invalidRequest(request);
  }
  if (Object.hasOwn(value, SkillRequestFamily.ToolsList)) {
    return decodeToolsList(value);
  }
  if (Object.hasOwn(value, SkillRequestFamily.CortexArticleStructure)) {
    return decodeCortexArticleAction(value);
  }
  const request: InvalidSkillRequest = {
    path: unknownSkillCommandPath(''),
    message: 'Unknown skill request family.',
  };
  return invalidRequest(request);
}
export function executeSkillAction(
  request: SkillActionRequest,
): SkillActionResult {
  if (request.family === SkillRequestFamily.ToolsList) {
    return listDiscoverableSkillActions();
  }
  return executeCortexArticleAction(request.request);
}
export function defaultSkillBlueprint(): string {
  return TOOLS_LIST_EXAMPLE;
}
function decodeToolsList(
  root: UntrustedSkillYamlMap,
): SkillActionDecodeOutcome {
  const familyRequest: SkillYamlPropertyRequest = {
    map: root,
    key: SkillRequestFamily.ToolsList,
  };
  const family = skillYamlProperty(familyRequest);
  if (!family.found || !isSkillYamlMap(family.value)) {
    const request: InvalidSkillRequest = {
      path: 'skillToolsList',
      message: 'Expected an action object.',
    };
    return invalidRequest(request);
  }
  const keys = Object.keys(family.value);
  const listRequest: SkillYamlPropertyRequest = {
    map: family.value,
    key: SkillToolsOperation.List,
  };
  const list = skillYamlProperty(listRequest);
  const extra = keys.find((key) => key !== SkillToolsOperation.List);
  if (typeof extra === 'string') {
    const request: InvalidSkillRequest = {
      path: unknownSkillCommandPath('skillToolsList'),
      message: 'Expected only the empty list action.',
    };
    return invalidRequest(request);
  }
  if (!list.found || !isSkillYamlMap(list.value)) {
    const request: InvalidSkillRequest = {
      path: 'skillToolsList.list',
      message: 'Expected the empty list action.',
    };
    return invalidRequest(request);
  }
  const listExtra = Object.keys(list.value).at(0);
  if (typeof listExtra === 'string') {
    const request: InvalidSkillRequest = {
      path: unknownSkillCommandPath('skillToolsList.list'),
      message: 'Expected the empty list action.',
    };
    return invalidRequest(request);
  }
  return {
    ok: true,
    request: {
      family: SkillRequestFamily.ToolsList,
      operation: SkillToolsOperation.List,
    },
  };
}
function decodeCortexArticleAction(
  root: UntrustedSkillYamlMap,
): SkillActionDecodeOutcome {
  const familyRequest: SkillYamlPropertyRequest = {
    map: root,
    key: SkillRequestFamily.CortexArticleStructure,
  };
  const family = skillYamlProperty(familyRequest);
  if (!family.found || !isSkillYamlMap(family.value)) {
    const request: InvalidSkillRequest = {
      path: 'cortexArticleStructure',
      message: 'Expected an action object.',
    };
    return invalidRequest(request);
  }
  const auditRequest: SkillYamlPropertyRequest = {
    map: family.value,
    key: CortexArticleStructureOperation.Audit,
  };
  const audit = skillYamlProperty(auditRequest);
  const operation = Object.keys(family.value).find(
    (key) => key !== CortexArticleStructureOperation.Audit,
  );
  if (typeof operation === 'string') {
    const request: InvalidSkillRequest = {
      path: unknownSkillCommandPath('cortexArticleStructure'),
      message: 'Expected only the audit action.',
    };
    return invalidRequest(request);
  }
  if (!audit.found) {
    const request: InvalidSkillRequest = {
      path: 'cortexArticleStructure.audit',
      message: 'Expected the audit action.',
    };
    return invalidRequest(request);
  }
  const validationRequest: SkillSchemaValidationRequest = {
    path: 'cortexArticleStructure.audit',
    schema: CORTEX_ARTICLE_ACTION_DEFINITION.inputSchema,
    value: audit.value,
  };
  const validation = validateSkillInput(validationRequest);
  if (!validation.ok) {
    const request: InvalidSkillRequest = {
      path: validation.path,
      message: validation.message,
    };
    return invalidRequest(request);
  }
  try {
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.CortexArticleStructure,
        operation: CortexArticleStructureOperation.Audit,
        request: decodeCortexArticleActionPayload(JSON.stringify(audit.value)),
      },
    };
  } catch (error) {
    const suffix =
      error instanceof CortexArticleRequestDecodeError ? error.path : '';
    const separator = suffix.startsWith('[') ? '' : '.';
    const request: InvalidSkillRequest = {
      path: `cortexArticleStructure.audit${suffix ? `${separator}${suffix}` : ''}`,
      message: error instanceof Error ? error.message : String(error),
    };
    return invalidRequest(request);
  }
}
type InvalidSkillRequest = {
  readonly path: string;
  readonly message: string;
};
function invalidRequest(
  request: InvalidSkillRequest,
): SkillActionDecodeOutcome {
  return { ok: false, path: request.path, message: request.message };
}
export const SKILL_FINDING_CODES = Object.freeze(
  Object.values(CortexArticleFindingCode),
);
export { CortexArticleFindingCode } from '../../../cortex-article-structure/scripts/src/domain.ts';
export const SKILL_PROVIDER_RESULT_BYTE_LIMIT =
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT;
