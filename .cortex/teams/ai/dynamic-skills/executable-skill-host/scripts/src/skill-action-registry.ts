import {
  CortexArticleFindingCode,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type CortexArticleStructureResult,
} from '../../../cortex-article-structure/scripts/src/domain.ts';

import {
  CORTEX_ARTICLE_ACTION_DEFINITION,
  CortexArticleRequestDecodeError,
  executeCortexArticleAction,
  CortexArticleActionDecoder,
} from '../../../cortex-article-structure/scripts/src/action.ts';

import type { CortexDocumentMapResult } from '../../../cortex-document-map/scripts/src/domain.ts';

import {
  CORTEX_DOCUMENT_MAP_ACTION_DEFINITION,
  CortexDocumentMapRequestDecodeError,
  executeCortexDocumentMapAction,
  CortexDocumentMapActionDecoder,
} from '../../../cortex-document-map/scripts/src/action.ts';

import {
  CORTEX_CONSISTENCY_ACTION_DEFINITION,
  CortexConsistencyRequestDecodeError,
  decodeCortexConsistencyActionPayload,
  executeCortexConsistencyAction,
} from '../../../cortex-consistency/scripts/src/action.ts';

import type { CortexConsistencyResult } from '../../../cortex-consistency/scripts/src/domain.ts';

import { CortexContractFindingCode } from '../../../cortex-consistency/scripts/src/domain.ts';

import {
  DELEGATION_VISUALIZATION_ACTION_DEFINITION,
  decodeDelegationVisualizationActionPayload,
  DelegationVisualizationRequestDecodeError,
  executeDelegationVisualizationAction,
} from '../../../delegation-visualization/scripts/src/action.ts';

import type { DelegationVisualizationResult } from '../../../delegation-visualization/scripts/src/domain.ts';

import {
  CortexArticleStructureOperation,
  CortexConsistencyOperation,
  CortexDocumentMapOperation,
  DelegationVisualizationOperation,
  SkillRequestFamily,
  SKILL_HOST_REQUEST_BYTE_LIMIT,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  SkillSchemaType,
  SkillToolsOperation,
  type DiscoverableSkillAction,
  type SkillObjectSchema,
  type SkillToolsListResult,
} from './skill-command-domain.ts';

import {
  type SkillYamlPropertyRequest,
  type UntrustedSkillYamlMap,
  type UntrustedSkillYamlNode,
  ExecutableSkillYaml,
} from './skill-yaml-codec.ts';

import {
  type SkillSchemaValidationRequest,
  ExecutableSkillInputSchema,
} from './skill-schema-validator.ts';

import { ExecutableSkillCommandPath } from './skill-command-path.ts';

export class ExecutableSkillActions {
  private constructor(private readonly request: UntrustedSkillYamlNode) {}

  static listDiscoverableSkillActions(): SkillToolsListResult {
    return { actions: DISCOVERABLE_ACTIONS };
  }

  static decodeSkillActionRequest(
    value: UntrustedSkillYamlNode,
  ): SkillActionDecodeOutcome {
    return new ExecutableSkillActions(value).execute();
  }

  private execute(): SkillActionDecodeOutcome {
    const value = this.request;
    if (
      !ExecutableSkillYaml.isSkillYamlMap(value) ||
      Object.keys(value).length !== 1
    ) {
      const request: InvalidSkillRequest = {
        path: '',
        message: 'Expected exactly one skill request family.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    if (Object.hasOwn(value, SkillRequestFamily.ToolsList)) {
      return ExecutableSkillActions.decodeToolsList(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.CortexArticleStructure)) {
      return ExecutableSkillActions.decodeCortexArticleAction(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.CortexDocumentMap)) {
      return ExecutableSkillActions.decodeCortexDocumentMapAction(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.CortexConsistency)) {
      return ExecutableSkillActions.decodeCortexConsistencyAction(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.DelegationVisualization)) {
      return ExecutableSkillActions.decodeDelegationVisualizationAction(value);
    }
    const request: InvalidSkillRequest = {
      path: ExecutableSkillCommandPath.unknownSkillCommandPath(''),
      message: 'Unknown skill request family.',
    };
    return ExecutableSkillActions.invalidRequest(request);
  }

  static executeSkillAction(request: SkillActionRequest): SkillActionResult {
    if (request.family === SkillRequestFamily.ToolsList) {
      return ExecutableSkillActions.listDiscoverableSkillActions();
    }
    if (request.family === SkillRequestFamily.CortexArticleStructure) {
      return executeCortexArticleAction(request.request);
    }
    if (request.family === SkillRequestFamily.CortexDocumentMap) {
      return executeCortexDocumentMapAction(request.request);
    }
    return request.family === SkillRequestFamily.CortexConsistency
      ? executeCortexConsistencyAction(request.request)
      : executeDelegationVisualizationAction(request.request);
  }

  static defaultSkillBlueprint(): string {
    return TOOLS_LIST_EXAMPLE;
  }

  private static decodeToolsList(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const familyRequest: SkillYamlPropertyRequest = {
      map: root,
      key: SkillRequestFamily.ToolsList,
    };
    const family = ExecutableSkillYaml.skillYamlProperty(familyRequest);
    if (!family.found || !ExecutableSkillYaml.isSkillYamlMap(family.value)) {
      const request: InvalidSkillRequest = {
        path: 'skillToolsList',
        message: 'Expected an action object.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    const keys = Object.keys(family.value);
    const listRequest: SkillYamlPropertyRequest = {
      map: family.value,
      key: SkillToolsOperation.List,
    };
    const list = ExecutableSkillYaml.skillYamlProperty(listRequest);
    const extra = keys.find((key) => key !== SkillToolsOperation.List);
    if (typeof extra === 'string') {
      const request: InvalidSkillRequest = {
        path: ExecutableSkillCommandPath.unknownSkillCommandPath(
          'skillToolsList',
        ),
        message: 'Expected only the empty list action.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    if (!list.found || !ExecutableSkillYaml.isSkillYamlMap(list.value)) {
      const request: InvalidSkillRequest = {
        path: 'skillToolsList.list',
        message: 'Expected the empty list action.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    const listExtra = Object.keys(list.value).at(0);
    if (typeof listExtra === 'string') {
      const request: InvalidSkillRequest = {
        path: ExecutableSkillCommandPath.unknownSkillCommandPath(
          'skillToolsList.list',
        ),
        message: 'Expected the empty list action.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.ToolsList,
        operation: SkillToolsOperation.List,
      },
    };
  }

  private static decodeCortexArticleAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const familyRequest: SkillYamlPropertyRequest = {
      map: root,
      key: SkillRequestFamily.CortexArticleStructure,
    };
    const family = ExecutableSkillYaml.skillYamlProperty(familyRequest);
    if (!family.found || !ExecutableSkillYaml.isSkillYamlMap(family.value)) {
      const request: InvalidSkillRequest = {
        path: 'cortexArticleStructure',
        message: 'Expected an action object.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    const auditRequest: SkillYamlPropertyRequest = {
      map: family.value,
      key: CortexArticleStructureOperation.Audit,
    };
    const audit = ExecutableSkillYaml.skillYamlProperty(auditRequest);
    const operation = Object.keys(family.value).find(
      (key) => key !== CortexArticleStructureOperation.Audit,
    );
    if (typeof operation === 'string') {
      const request: InvalidSkillRequest = {
        path: ExecutableSkillCommandPath.unknownSkillCommandPath(
          'cortexArticleStructure',
        ),
        message: 'Expected only the audit action.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    if (!audit.found) {
      const request: InvalidSkillRequest = {
        path: 'cortexArticleStructure.audit',
        message: 'Expected the audit action.',
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    const validationRequest: SkillSchemaValidationRequest = {
      path: 'cortexArticleStructure.audit',
      schema: CORTEX_ARTICLE_ACTION_DEFINITION.inputSchema,
      value: audit.value,
    };
    const validation =
      ExecutableSkillInputSchema.validateSkillInput(validationRequest);
    if (!validation.ok) {
      const request: InvalidSkillRequest = {
        path: validation.path,
        message: validation.message,
      };
      return ExecutableSkillActions.invalidRequest(request);
    }
    try {
      return {
        ok: true,
        request: {
          family: SkillRequestFamily.CortexArticleStructure,
          operation: CortexArticleStructureOperation.Audit,
          request: CortexArticleActionDecoder.decodeCortexArticleActionPayload(
            JSON.stringify(audit.value),
          ),
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
      return ExecutableSkillActions.invalidRequest(request);
    }
  }

  private static decodeCortexDocumentMapAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const family = ExecutableSkillYaml.skillYamlProperty({
      map: root,
      key: SkillRequestFamily.CortexDocumentMap,
    });
    if (!family.found || !ExecutableSkillYaml.isSkillYamlMap(family.value)) {
      return ExecutableSkillActions.invalidRequest({
        path: 'cortexDocumentMap',
        message: 'Expected an action object.',
      });
    }
    const audit = ExecutableSkillYaml.skillYamlProperty({
      map: family.value,
      key: CortexDocumentMapOperation.Audit,
    });
    const operation = Object.keys(family.value).find(
      (key) => key !== CortexDocumentMapOperation.Audit,
    );
    if (typeof operation === 'string') {
      return ExecutableSkillActions.invalidRequest({
        path: ExecutableSkillCommandPath.unknownSkillCommandPath(
          'cortexDocumentMap',
        ),
        message: 'Expected only the audit action.',
      });
    }
    if (!audit.found) {
      return ExecutableSkillActions.invalidRequest({
        path: 'cortexDocumentMap.audit',
        message: 'Expected the audit action.',
      });
    }
    const validation = ExecutableSkillInputSchema.validateSkillInput({
      path: 'cortexDocumentMap.audit',
      schema: CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.inputSchema,
      value: audit.value,
    });
    if (!validation.ok) {
      return ExecutableSkillActions.invalidRequest({
        path: validation.path,
        message: validation.message,
      });
    }
    try {
      return {
        ok: true,
        request: {
          family: SkillRequestFamily.CortexDocumentMap,
          operation: CortexDocumentMapOperation.Audit,
          request:
            CortexDocumentMapActionDecoder.decodeCortexDocumentMapActionPayload(
              JSON.stringify(audit.value),
            ),
        },
      };
    } catch (error) {
      const suffix =
        error instanceof CortexDocumentMapRequestDecodeError ? error.path : '';
      const separator = suffix.startsWith('[') ? '' : '.';
      return ExecutableSkillActions.invalidRequest({
        path: `cortexDocumentMap.audit${suffix ? `${separator}${suffix}` : ''}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private static decodeCortexConsistencyAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const familyRequest: SkillYamlPropertyRequest = {
      map: root,
      key: SkillRequestFamily.CortexConsistency,
    };
    const family = ExecutableSkillYaml.skillYamlProperty(familyRequest);
    if (!family.found || !ExecutableSkillYaml.isSkillYamlMap(family.value)) {
      return ExecutableSkillActions.invalidRequest({
        path: 'cortexConsistency',
        message: 'Expected an action object.',
      });
    }
    const compileRequest: SkillYamlPropertyRequest = {
      map: family.value,
      key: CortexConsistencyOperation.Compile,
    };
    const compile = ExecutableSkillYaml.skillYamlProperty(compileRequest);
    const operation = Object.keys(family.value).find(
      (key) => key !== CortexConsistencyOperation.Compile,
    );
    if (typeof operation === 'string') {
      return ExecutableSkillActions.invalidRequest({
        path: ExecutableSkillCommandPath.unknownSkillCommandPath(
          'cortexConsistency',
        ),
        message: 'Expected only the compile action.',
      });
    }
    if (!compile.found) {
      return ExecutableSkillActions.invalidRequest({
        path: 'cortexConsistency.compile',
        message: 'Expected the compile action.',
      });
    }
    const validation = ExecutableSkillInputSchema.validateSkillInput({
      path: 'cortexConsistency.compile',
      schema: CORTEX_CONSISTENCY_ACTION_DEFINITION.inputSchema,
      value: compile.value,
    });
    if (!validation.ok) {
      return ExecutableSkillActions.invalidRequest({
        path: validation.path,
        message: validation.message,
      });
    }
    try {
      return {
        ok: true,
        request: {
          family: SkillRequestFamily.CortexConsistency,
          operation: CortexConsistencyOperation.Compile,
          request: decodeCortexConsistencyActionPayload(
            JSON.stringify(compile.value),
          ),
        },
      };
    } catch (error) {
      const suffix =
        error instanceof CortexConsistencyRequestDecodeError ? error.path : '';
      const separator = suffix.startsWith('[') ? '' : '.';
      return ExecutableSkillActions.invalidRequest({
        path: `cortexConsistency.compile${suffix ? `${separator}${suffix}` : ''}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private static decodeDelegationVisualizationAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const family = ExecutableSkillYaml.skillYamlProperty({
      map: root,
      key: SkillRequestFamily.DelegationVisualization,
    });
    if (!family.found || !ExecutableSkillYaml.isSkillYamlMap(family.value)) {
      return ExecutableSkillActions.invalidRequest({
        path: 'delegationVisualization',
        message: 'Expected an action object.',
      });
    }
    const render = ExecutableSkillYaml.skillYamlProperty({
      map: family.value,
      key: DelegationVisualizationOperation.Render,
    });
    const operation = Object.keys(family.value).find(
      (key) => key !== DelegationVisualizationOperation.Render,
    );
    if (typeof operation === 'string') {
      return ExecutableSkillActions.invalidRequest({
        path: ExecutableSkillCommandPath.unknownSkillCommandPath(
          'delegationVisualization',
        ),
        message: 'Expected only the render action.',
      });
    }
    if (!render.found) {
      return ExecutableSkillActions.invalidRequest({
        path: 'delegationVisualization.render',
        message: 'Expected the render action.',
      });
    }
    const validation = ExecutableSkillInputSchema.validateSkillInput({
      path: 'delegationVisualization.render',
      schema: DELEGATION_VISUALIZATION_ACTION_DEFINITION.inputSchema,
      value: render.value,
    });
    if (!validation.ok) {
      return ExecutableSkillActions.invalidRequest({
        path: validation.path,
        message: validation.message,
      });
    }
    try {
      return {
        ok: true,
        request: {
          family: SkillRequestFamily.DelegationVisualization,
          operation: DelegationVisualizationOperation.Render,
          request: decodeDelegationVisualizationActionPayload(
            JSON.stringify(render.value),
          ),
        },
      };
    } catch (error) {
      const suffix =
        error instanceof DelegationVisualizationRequestDecodeError
          ? error.path
          : '';
      const separator = suffix.startsWith('[') ? '' : '.';
      return ExecutableSkillActions.invalidRequest({
        path: `delegationVisualization.render${suffix ? `${separator}${suffix}` : ''}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private static invalidRequest(
    request: InvalidSkillRequest,
  ): SkillActionDecodeOutcome {
    return { ok: false, path: request.path, message: request.message };
  }
}

export const SKILL_TOOLS_LIST_INVOKE = 'task skills:tools-list';

export const SKILL_RUN_INVOKE = "task skills:run REQUEST_YAML='<strict-yaml>'";

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
  maximumRequestBytes: SKILL_HOST_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: SKILL_HOST_RESPONSE_BYTE_LIMIT,
};

const CORTEX_DOCUMENT_MAP_DISCOVERY_SCHEMA: SkillObjectSchema = {
  ...CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.inputSchema,
  maximumRequestBytes: SKILL_HOST_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: SKILL_HOST_RESPONSE_BYTE_LIMIT,
};

const CORTEX_CONSISTENCY_DISCOVERY_SCHEMA: SkillObjectSchema = {
  ...CORTEX_CONSISTENCY_ACTION_DEFINITION.inputSchema,
  maximumRequestBytes: SKILL_HOST_REQUEST_BYTE_LIMIT,
  maximumResponseBytes: SKILL_HOST_RESPONSE_BYTE_LIMIT,
};

const DELEGATION_VISUALIZATION_DISCOVERY_SCHEMA: SkillObjectSchema = {
  ...DELEGATION_VISUALIZATION_ACTION_DEFINITION.inputSchema,
  maximumRequestBytes: SKILL_HOST_REQUEST_BYTE_LIMIT,
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
    exampleRequest: SKILL_RUN_INVOKE,
    exampleYaml: CORTEX_ARTICLE_ACTION_DEFINITION.exampleYaml,
    resolvedExampleYaml: CORTEX_ARTICLE_ACTION_DEFINITION.resolvedExampleYaml,
    inputSchema: CORTEX_ARTICLE_DISCOVERY_SCHEMA,
  },
  {
    skillId: CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.skillId,
    family: SkillRequestFamily.CortexDocumentMap,
    operation: CortexDocumentMapOperation.Audit,
    description: CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.description,
    exampleRequest: SKILL_RUN_INVOKE,
    exampleYaml: CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.exampleYaml,
    resolvedExampleYaml:
      CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.resolvedExampleYaml,
    inputSchema: CORTEX_DOCUMENT_MAP_DISCOVERY_SCHEMA,
  },
  {
    skillId: CORTEX_CONSISTENCY_ACTION_DEFINITION.skillId,
    family: SkillRequestFamily.CortexConsistency,
    operation: CortexConsistencyOperation.Compile,
    description: CORTEX_CONSISTENCY_ACTION_DEFINITION.description,
    exampleRequest: SKILL_RUN_INVOKE,
    exampleYaml: CORTEX_CONSISTENCY_ACTION_DEFINITION.exampleYaml,
    resolvedExampleYaml:
      CORTEX_CONSISTENCY_ACTION_DEFINITION.resolvedExampleYaml,
    inputSchema: CORTEX_CONSISTENCY_DISCOVERY_SCHEMA,
  },
  {
    skillId: DELEGATION_VISUALIZATION_ACTION_DEFINITION.skillId,
    family: SkillRequestFamily.DelegationVisualization,
    operation: DelegationVisualizationOperation.Render,
    description: DELEGATION_VISUALIZATION_ACTION_DEFINITION.description,
    exampleRequest: SKILL_RUN_INVOKE,
    exampleYaml: DELEGATION_VISUALIZATION_ACTION_DEFINITION.exampleYaml,
    resolvedExampleYaml:
      DELEGATION_VISUALIZATION_ACTION_DEFINITION.resolvedExampleYaml,
    inputSchema: DELEGATION_VISUALIZATION_DISCOVERY_SCHEMA,
  },
];

export type SkillActionRequest =
  | {
      readonly family: SkillRequestFamily.ToolsList;
      readonly operation: SkillToolsOperation.List;
    }
  | {
      readonly family: SkillRequestFamily.CortexArticleStructure;
      readonly operation: CortexArticleStructureOperation.Audit;
      readonly request: ReturnType<
        typeof CortexArticleActionDecoder.decodeCortexArticleActionPayload
      >;
    }
  | {
      readonly family: SkillRequestFamily.CortexDocumentMap;
      readonly operation: CortexDocumentMapOperation.Audit;
      readonly request: ReturnType<
        typeof CortexDocumentMapActionDecoder.decodeCortexDocumentMapActionPayload
      >;
    }
  | {
      readonly family: SkillRequestFamily.CortexConsistency;
      readonly operation: CortexConsistencyOperation.Compile;
      readonly request: ReturnType<typeof decodeCortexConsistencyActionPayload>;
    }
  | {
      readonly family: SkillRequestFamily.DelegationVisualization;
      readonly operation: DelegationVisualizationOperation.Render;
      readonly request: ReturnType<
        typeof decodeDelegationVisualizationActionPayload
      >;
    };

export type SkillActionResult =
  | SkillToolsListResult
  | CortexArticleStructureResult
  | CortexConsistencyResult
  | CortexDocumentMapResult
  | DelegationVisualizationResult;

export type SkillActionDecodeOutcome =
  | { readonly ok: true; readonly request: SkillActionRequest }
  | { readonly ok: false; readonly path: string; readonly message: string };

type InvalidSkillRequest = {
  readonly path: string;
  readonly message: string;
};

export const SKILL_FINDING_CODES = Object.freeze([
  ...Object.values(CortexArticleFindingCode),
  ...Object.values(CortexContractFindingCode),
]);

export { CortexArticleFindingCode } from '../../../cortex-article-structure/scripts/src/domain.ts';

export { CortexContractFindingCode } from '../../../cortex-consistency/scripts/src/domain.ts';

export const SKILL_PROVIDER_RESULT_BYTE_LIMIT =
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT;
