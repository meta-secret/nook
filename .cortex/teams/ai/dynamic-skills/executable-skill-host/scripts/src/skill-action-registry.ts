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
export type SkillActionResult = SkillToolsListResult;
export type SkillActionDecodeOutcome =
  | { readonly ok: true; readonly request: SkillActionRequest }
  | { readonly ok: false; readonly path: string; readonly message: string };

export function decodeSkillActionRequest(
  value: UntrustedSkillYamlNode,
): SkillActionDecodeOutcome {
  if (!isSkillYamlMap(value) || Object.keys(value).length !== 1) {
    return invalidRequest({
      path: '',
      message: 'Expected exactly one skill request family.',
    });
  }
  if (Object.hasOwn(value, SkillRequestFamily.ToolsList)) {
    return decodeToolsList(value);
  }
  return invalidRequest({
    path: unknownSkillCommandPath(''),
    message: 'Unknown skill request family.',
  });
}

export function executeSkillAction(
  _request: SkillActionRequest,
): SkillActionResult {
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
    return invalidRequest({
      path: 'skillToolsList',
      message: 'Expected an action object.',
    });
  }
  const listRequest: SkillYamlPropertyRequest = {
    map: family.value,
    key: SkillToolsOperation.List,
  };
  const list = skillYamlProperty(listRequest);
  const extra = Object.keys(family.value).find(
    (key) => key !== SkillToolsOperation.List,
  );
  if (typeof extra === 'string') {
    return invalidRequest({
      path: unknownSkillCommandPath('skillToolsList'),
      message: 'Expected only the empty list action.',
    });
  }
  if (!list.found || !isSkillYamlMap(list.value)) {
    return invalidRequest({
      path: 'skillToolsList.list',
      message: 'Expected the empty list action.',
    });
  }
  const listExtra = Object.keys(list.value).at(0);
  if (typeof listExtra === 'string') {
    return invalidRequest({
      path: unknownSkillCommandPath('skillToolsList.list'),
      message: 'Expected the empty list action.',
    });
  }
  return {
    ok: true,
    request: {
      family: SkillRequestFamily.ToolsList,
      operation: SkillToolsOperation.List,
    },
  };
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
