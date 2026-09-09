import { ExecutableSkillYamlProperty } from './skill-yaml-codec.ts';
import { UnknownSkillCommandPath } from './skill-command-path.ts';
import { SkillYamlValue } from './skill-yaml-codec.ts';
import type { CortexDocumentMapFailure } from '../../../cortex-document-map/scripts/src/application.ts';
import { err, ok, type Result } from 'neverthrow';
import type { CompileCortexContractsRequest } from '../../../cortex-consistency/scripts/src/domain.ts';
import type { RenderDelegationVisualizationRequest } from '../../../delegation-visualization/scripts/src/domain.ts';
import type { AuditCortexArticleStructureRequest } from '../../../cortex-article-structure/scripts/src/domain.ts';
import type { AuditCortexDocumentMapRequest } from '../../../cortex-document-map/scripts/src/domain.ts';
import type { DelegationVisualizationResultVerificationError } from '../../../delegation-visualization/scripts/src/result-codec.ts';
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
  decodeCortexConsistencyActionPayload,
  executeCortexConsistencyAction,
} from '../../../cortex-consistency/scripts/src/action.ts';

import type { CortexConsistencyResult } from '../../../cortex-consistency/scripts/src/domain.ts';

import { CortexContractFindingCode } from '../../../cortex-consistency/scripts/src/domain.ts';

import {
  DELEGATION_VISUALIZATION_ACTION_DEFINITION,
  decodeDelegationVisualizationActionPayload,
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

  static from(value: UntrustedSkillYamlNode): ExecutableSkillActions {
    return new ExecutableSkillActions(value);
  }

  execute(): Result<AdmittedSkillAction, InvalidSkillRequest> {
    const decoded = this.decode();
    if (!decoded.ok)
      return err({ path: decoded.path, message: decoded.message });
    return AdmittedSkillAction.admit({
      key: SKILL_ADMISSION,
      request: decoded.request,
    });
  }

  private decode(): SkillActionDecodeOutcome {
    const candidate = new SkillYamlValue(this.request);
    if (!candidate.isMap() || Object.keys(candidate.value).length !== 1) {
      const request: InvalidSkillRequest = {
        path: '',
        message: 'Expected exactly one skill request family.',
      };
      return this.invalidRequest(request);
    }
    const value = candidate.value;
    if (Object.hasOwn(value, SkillRequestFamily.ToolsList)) {
      return this.decodeToolsList(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.CortexArticleStructure)) {
      return this.decodeCortexArticleAction(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.CortexDocumentMap)) {
      return this.decodeCortexDocumentMapAction(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.CortexConsistency)) {
      return this.decodeCortexConsistencyAction(value);
    }
    if (Object.hasOwn(value, SkillRequestFamily.DelegationVisualization)) {
      return this.decodeDelegationVisualizationAction(value);
    }
    const request: InvalidSkillRequest = {
      path: new UnknownSkillCommandPath('').execute(),
      message: 'Unknown skill request family.',
    };
    return this.invalidRequest(request);
  }

  private decodeToolsList(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const familyRequest: SkillYamlPropertyRequest = {
      map: root,
      key: SkillRequestFamily.ToolsList,
    };
    const family = new ExecutableSkillYamlProperty(familyRequest).execute();
    const familyValue = new SkillYamlValue(family.found ? family.value : false);
    if (!family.found || !familyValue.isMap()) {
      const request: InvalidSkillRequest = {
        path: 'skillToolsList',
        message: 'Expected an action object.',
      };
      return this.invalidRequest(request);
    }
    const keys = Object.keys(familyValue.value);
    const listRequest: SkillYamlPropertyRequest = {
      map: familyValue.value,
      key: SkillToolsOperation.List,
    };
    const list = new ExecutableSkillYamlProperty(listRequest).execute();
    const extra = keys.find((key) => key !== SkillToolsOperation.List);
    if (typeof extra === 'string') {
      const request: InvalidSkillRequest = {
        path: new UnknownSkillCommandPath('skillToolsList').execute(),
        message: 'Expected only the empty list action.',
      };
      return this.invalidRequest(request);
    }
    const listValue = new SkillYamlValue(list.found ? list.value : false);
    if (!list.found || !listValue.isMap()) {
      const request: InvalidSkillRequest = {
        path: 'skillToolsList.list',
        message: 'Expected the empty list action.',
      };
      return this.invalidRequest(request);
    }
    const listExtra = Object.keys(listValue.value).at(0);
    if (typeof listExtra === 'string') {
      const request: InvalidSkillRequest = {
        path: new UnknownSkillCommandPath('skillToolsList.list').execute(),
        message: 'Expected the empty list action.',
      };
      return this.invalidRequest(request);
    }
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.ToolsList,
        operation: SkillToolsOperation.List,
      },
    };
  }

  private decodeCortexArticleAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const familyRequest: SkillYamlPropertyRequest = {
      map: root,
      key: SkillRequestFamily.CortexArticleStructure,
    };
    const family = new ExecutableSkillYamlProperty(familyRequest).execute();
    const familyValue = new SkillYamlValue(family.found ? family.value : false);
    if (!family.found || !familyValue.isMap()) {
      const request: InvalidSkillRequest = {
        path: 'cortexArticleStructure',
        message: 'Expected an action object.',
      };
      return this.invalidRequest(request);
    }
    const auditRequest: SkillYamlPropertyRequest = {
      map: familyValue.value,
      key: CortexArticleStructureOperation.Audit,
    };
    const audit = new ExecutableSkillYamlProperty(auditRequest).execute();
    const operation = Object.keys(familyValue.value).find(
      (key) => key !== CortexArticleStructureOperation.Audit,
    );
    if (typeof operation === 'string') {
      const request: InvalidSkillRequest = {
        path: new UnknownSkillCommandPath('cortexArticleStructure').execute(),
        message: 'Expected only the audit action.',
      };
      return this.invalidRequest(request);
    }
    if (!audit.found) {
      const request: InvalidSkillRequest = {
        path: 'cortexArticleStructure.audit',
        message: 'Expected the audit action.',
      };
      return this.invalidRequest(request);
    }
    const validationRequest: SkillSchemaValidationRequest = {
      path: 'cortexArticleStructure.audit',
      schema: CORTEX_ARTICLE_ACTION_DEFINITION.inputSchema,
      value: audit.value,
    };
    const validation =
      ExecutableSkillInputSchema.from(validationRequest).execute();
    if (!validation.isOk()) {
      const request: InvalidSkillRequest = {
        path: validation.error.path,
        message: validation.error.message,
      };
      return this.invalidRequest(request);
    }
    const decoded = CortexArticleActionDecoder.from(
      JSON.stringify(audit.value),
    ).execute();
    if (decoded.isErr()) {
      const suffix = decoded.error.path;
      const separator = suffix.startsWith('[') ? '' : '.';
      return this.invalidRequest({
        path: `cortexArticleStructure.audit${suffix ? `${separator}${suffix}` : ''}`,
        message: decoded.error.message,
      });
    }
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.CortexArticleStructure,
        operation: CortexArticleStructureOperation.Audit,
        request: decoded.value,
      },
    };
  }

  private decodeCortexDocumentMapAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const family = new ExecutableSkillYamlProperty({
      map: root,
      key: SkillRequestFamily.CortexDocumentMap,
    }).execute();
    const familyValue = new SkillYamlValue(family.found ? family.value : false);
    if (!family.found || !familyValue.isMap()) {
      return this.invalidRequest({
        path: 'cortexDocumentMap',
        message: 'Expected an action object.',
      });
    }
    const audit = new ExecutableSkillYamlProperty({
      map: familyValue.value,
      key: CortexDocumentMapOperation.Audit,
    }).execute();
    const operation = Object.keys(familyValue.value).find(
      (key) => key !== CortexDocumentMapOperation.Audit,
    );
    if (typeof operation === 'string') {
      return this.invalidRequest({
        path: new UnknownSkillCommandPath('cortexDocumentMap').execute(),
        message: 'Expected only the audit action.',
      });
    }
    if (!audit.found) {
      return this.invalidRequest({
        path: 'cortexDocumentMap.audit',
        message: 'Expected the audit action.',
      });
    }
    const validation = ExecutableSkillInputSchema.from({
      path: 'cortexDocumentMap.audit',
      schema: CORTEX_DOCUMENT_MAP_ACTION_DEFINITION.inputSchema,
      value: audit.value,
    }).execute();
    if (!validation.isOk()) {
      return this.invalidRequest({
        path: validation.error.path,
        message: validation.error.message,
      });
    }
    const decoded = CortexDocumentMapActionDecoder.from(
      JSON.stringify(audit.value),
    ).execute();
    if (decoded.isErr()) {
      const suffix = decoded.error.path;
      const separator = suffix.startsWith('[') ? '' : '.';
      return this.invalidRequest({
        path: `cortexDocumentMap.audit${suffix ? `${separator}${suffix}` : ''}`,
        message: decoded.error.message,
      });
    }
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.CortexDocumentMap,
        operation: CortexDocumentMapOperation.Audit,
        request: decoded.value,
      },
    };
  }

  private decodeCortexConsistencyAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const familyRequest: SkillYamlPropertyRequest = {
      map: root,
      key: SkillRequestFamily.CortexConsistency,
    };
    const family = new ExecutableSkillYamlProperty(familyRequest).execute();
    const familyValue = new SkillYamlValue(family.found ? family.value : false);
    if (!family.found || !familyValue.isMap()) {
      return this.invalidRequest({
        path: 'cortexConsistency',
        message: 'Expected an action object.',
      });
    }
    const compileRequest: SkillYamlPropertyRequest = {
      map: familyValue.value,
      key: CortexConsistencyOperation.Compile,
    };
    const compile = new ExecutableSkillYamlProperty(compileRequest).execute();
    const operation = Object.keys(familyValue.value).find(
      (key) => key !== CortexConsistencyOperation.Compile,
    );
    if (typeof operation === 'string') {
      return this.invalidRequest({
        path: new UnknownSkillCommandPath('cortexConsistency').execute(),
        message: 'Expected only the compile action.',
      });
    }
    if (!compile.found) {
      return this.invalidRequest({
        path: 'cortexConsistency.compile',
        message: 'Expected the compile action.',
      });
    }
    const validation = ExecutableSkillInputSchema.from({
      path: 'cortexConsistency.compile',
      schema: CORTEX_CONSISTENCY_ACTION_DEFINITION.inputSchema,
      value: compile.value,
    }).execute();
    if (!validation.isOk()) {
      return this.invalidRequest({
        path: validation.error.path,
        message: validation.error.message,
      });
    }
    const decoded = decodeCortexConsistencyActionPayload(
      JSON.stringify(compile.value),
    );
    if (decoded.isErr()) {
      const suffix = decoded.error.path;
      const separator = suffix.startsWith('[') ? '' : '.';
      return this.invalidRequest({
        path: `cortexConsistency.compile${suffix ? `${separator}${suffix}` : ''}`,
        message: decoded.error.message,
      });
    }
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.CortexConsistency,
        operation: CortexConsistencyOperation.Compile,
        request: decoded.value,
      },
    };
  }

  private decodeDelegationVisualizationAction(
    root: UntrustedSkillYamlMap,
  ): SkillActionDecodeOutcome {
    const family = new ExecutableSkillYamlProperty({
      map: root,
      key: SkillRequestFamily.DelegationVisualization,
    }).execute();
    const familyValue = new SkillYamlValue(family.found ? family.value : false);
    if (!family.found || !familyValue.isMap()) {
      return this.invalidRequest({
        path: 'delegationVisualization',
        message: 'Expected an action object.',
      });
    }
    const render = new ExecutableSkillYamlProperty({
      map: familyValue.value,
      key: DelegationVisualizationOperation.Render,
    }).execute();
    const operation = Object.keys(familyValue.value).find(
      (key) => key !== DelegationVisualizationOperation.Render,
    );
    if (typeof operation === 'string') {
      return this.invalidRequest({
        path: new UnknownSkillCommandPath('delegationVisualization').execute(),
        message: 'Expected only the render action.',
      });
    }
    if (!render.found) {
      return this.invalidRequest({
        path: 'delegationVisualization.render',
        message: 'Expected the render action.',
      });
    }
    const validation = ExecutableSkillInputSchema.from({
      path: 'delegationVisualization.render',
      schema: DELEGATION_VISUALIZATION_ACTION_DEFINITION.inputSchema,
      value: render.value,
    }).execute();
    if (!validation.isOk()) {
      return this.invalidRequest({
        path: validation.error.path,
        message: validation.error.message,
      });
    }
    const decoded = decodeDelegationVisualizationActionPayload(
      JSON.stringify(render.value),
    );
    if (decoded.isErr()) {
      const suffix = decoded.error.path;
      const separator = suffix.startsWith('[') ? '' : '.';
      return this.invalidRequest({
        path: `delegationVisualization.render${suffix ? `${separator}${suffix}` : ''}`,
        message: decoded.error.message,
      });
    }
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.DelegationVisualization,
        operation: DelegationVisualizationOperation.Render,
        request: decoded.value,
      },
    };
  }

  private invalidRequest(
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
      readonly request: AuditCortexArticleStructureRequest;
    }
  | {
      readonly family: SkillRequestFamily.CortexDocumentMap;
      readonly operation: CortexDocumentMapOperation.Audit;
      readonly request: AuditCortexDocumentMapRequest;
    }
  | {
      readonly family: SkillRequestFamily.CortexConsistency;
      readonly operation: CortexConsistencyOperation.Compile;
      readonly request: CompileCortexContractsRequest;
    }
  | {
      readonly family: SkillRequestFamily.DelegationVisualization;
      readonly operation: DelegationVisualizationOperation.Render;
      readonly request: RenderDelegationVisualizationRequest;
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

const SKILL_ADMISSION = Symbol('validated-executable-skill-action');
type AdmittedSkillActionRequest = {
  readonly key: typeof SKILL_ADMISSION;
  readonly request: SkillActionRequest;
};
/** Validation issues the only executable capability; wire requests remain DTOs. */
export class AdmittedSkillAction {
  private constructor(private readonly request: SkillActionRequest) {}
  static admit(
    admission: AdmittedSkillActionRequest,
  ): Result<AdmittedSkillAction, InvalidSkillRequest> {
    if (admission.key !== SKILL_ADMISSION)
      return err({ path: '', message: 'Invalid executable skill admission.' });
    return ok(new AdmittedSkillAction(admission.request));
  }
  get family(): SkillActionRequest['family'] {
    return this.request.family;
  }
  get operation(): SkillActionRequest['operation'] {
    return this.request.operation;
  }
  execute(): Result<SkillActionResult, SkillExecutionFailure> {
    const request = this.request;
    if (request.family === SkillRequestFamily.ToolsList) {
      return ok(EXECUTABLE_SKILL_CATALOG.list());
    }
    if (request.family === SkillRequestFamily.CortexArticleStructure) {
      return executeCortexArticleAction(request.request);
    }
    if (request.family === SkillRequestFamily.CortexDocumentMap) {
      return executeCortexDocumentMapAction(request.request);
    }
    return request.family === SkillRequestFamily.CortexConsistency
      ? ok(executeCortexConsistencyAction(request.request))
      : executeDelegationVisualizationAction(request.request);
  }
}

export type SkillExecutionFailure =
  | CortexArticleRequestDecodeError
  | CortexDocumentMapFailure
  | DelegationVisualizationResultVerificationError;

export class ExecutableSkillCatalog {
  constructor(
    private readonly actions: readonly DiscoverableSkillAction[],
    private readonly blueprint: string,
  ) {}
  list(): SkillToolsListResult {
    return { actions: this.actions };
  }
  example(): string {
    return this.blueprint;
  }
}
export const EXECUTABLE_SKILL_CATALOG = new ExecutableSkillCatalog(
  DISCOVERABLE_ACTIONS,
  TOOLS_LIST_EXAMPLE,
);
