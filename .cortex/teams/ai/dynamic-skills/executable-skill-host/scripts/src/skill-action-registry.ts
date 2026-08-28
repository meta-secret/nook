import {
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
import { unknownSkillCommandPath } from './skill-command-path.ts';
export const SKILL_TOOLS_LIST_INVOKE = 'task skills:tools-list';
const TOOLS_LIST_EXAMPLE = `skillToolsList:
  list: {}
`;
const EMPTY_OBJECT_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: [],
  properties: {},
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
];
export function listDiscoverableSkillActions(): SkillToolsListResult {
  return { actions: DISCOVERABLE_ACTIONS };
}
export type SkillActionRequest = {
  readonly family: SkillRequestFamily.ToolsList;
  readonly operation: SkillToolsOperation.List;
};
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
  if (!Object.hasOwn(value, SkillRequestFamily.ToolsList)) {
    const request: InvalidSkillRequest = {
      path: unknownSkillCommandPath(''),
      message: 'Unknown skill request family.',
    };
    return invalidRequest(request);
  }
  return decodeToolsList(value);
}
export function executeSkillAction(
  request: SkillActionRequest,
): SkillToolsListResult {
  if (request.family !== SkillRequestFamily.ToolsList) {
    throw new Error('Unknown executable skill action.');
  }
  return listDiscoverableSkillActions();
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
  const listRequest: SkillYamlPropertyRequest = {
    map: family.value,
    key: SkillToolsOperation.List,
  };
  const list = skillYamlProperty(listRequest);
  if (
    Object.keys(family.value).some((key) => key !== SkillToolsOperation.List)
  ) {
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
  if (Object.keys(list.value).length > 0) {
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
type InvalidSkillRequest = { readonly path: string; readonly message: string };
function invalidRequest(
  request: InvalidSkillRequest,
): SkillActionDecodeOutcome {
  return { ok: false, path: request.path, message: request.message };
}
