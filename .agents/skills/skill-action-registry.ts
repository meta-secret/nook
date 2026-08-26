import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type CortexArticleStructureResult,
} from './cortex-article-structure/src/domain.ts';
import { decodeCortexArticleRequest } from './cortex-article-structure/src/codec.ts';
import { auditCortexArticleStructure } from './cortex-article-structure/src/audit.ts';
import {
  CortexArticleStructureOperation,
  SkillRequestFamily,
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

export const SKILL_TOOLS_LIST_INVOKE = 'task skills:tools-list';
export const SKILL_RUN_INVOKE = 'task skills:run CONFIG=<request.yaml>';

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
};

const HEADING_BLOCK_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: ['depth', 'kind', 'line', 'text'],
  properties: {
    depth: { type: SkillSchemaType.Integer, minimum: 1 },
    kind: {
      type: SkillSchemaType.String,
      enum: [CortexArticleSemanticKind.Heading],
    },
    line: { type: SkillSchemaType.Integer, minimum: 1 },
    text: { type: SkillSchemaType.String },
  },
};

const SIMPLE_BLOCK_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: ['kind', 'line'],
  properties: {
    kind: {
      type: SkillSchemaType.String,
      enum: [
        CortexArticleSemanticKind.Paragraph,
        CortexArticleSemanticKind.VisibleOrderedList,
        CortexArticleSemanticKind.Structure,
        CortexArticleSemanticKind.Transparent,
        CortexArticleSemanticKind.DensitySeparator,
      ],
    },
    line: { type: SkillSchemaType.Integer, minimum: 1 },
  },
};

const ARTICLE_DOCUMENT_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: ['relativePath', 'blocks'],
  properties: {
    relativePath: {
      type: SkillSchemaType.String,
      pattern: '^\\.cortex/.+\\.md$',
    },
    blocks: {
      type: SkillSchemaType.Array,
      items: {
        oneOf: [HEADING_BLOCK_SCHEMA, SIMPLE_BLOCK_SCHEMA],
      },
    },
  },
};

const MIGRATION_LEDGER_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: ['relativePath', 'content'],
  properties: {
    relativePath: {
      type: SkillSchemaType.String,
      enum: ['.cortex/article-structure-migration.txt'],
    },
    content: { type: SkillSchemaType.String },
  },
};

const CORTEX_ARTICLE_AUDIT_SCHEMA: SkillObjectSchema = {
  type: SkillSchemaType.Object,
  additionalProperties: false,
  required: [
    'kind',
    'documents',
    'migrationBaselineEntries',
    'migrationLedger',
  ],
  properties: {
    kind: {
      type: SkillSchemaType.String,
      enum: [CortexArticleContractKind.Request],
    },
    documents: {
      type: SkillSchemaType.Array,
      items: ARTICLE_DOCUMENT_SCHEMA,
    },
    migrationBaselineEntries: {
      oneOf: [
        {
          type: SkillSchemaType.Array,
          items: { type: SkillSchemaType.String },
        },
        { const: false },
      ],
    },
    migrationLedger: {
      ...MIGRATION_LEDGER_SCHEMA,
      properties: {
        ...MIGRATION_LEDGER_SCHEMA.properties,
        content: {
          oneOf: [{ type: SkillSchemaType.String }, { const: false }],
        },
      },
    },
  },
};

const DISCOVERABLE_ACTIONS: readonly DiscoverableSkillAction[] = [
  {
    skillId: 'skills',
    family: SkillRequestFamily.ToolsList,
    operation: SkillToolsOperation.List,
    description: 'List executable skill actions, YAML examples, and schemas.',
    exampleRequest: SKILL_TOOLS_LIST_INVOKE,
    exampleYaml: TOOLS_LIST_EXAMPLE,
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    skillId: 'cortex-article-structure',
    family: SkillRequestFamily.CortexArticleStructure,
    operation: CortexArticleStructureOperation.Audit,
    description: 'Audit semantic structure in Cortex Markdown articles.',
    exampleRequest: SKILL_RUN_INVOKE,
    exampleYaml: CORTEX_ARTICLE_AUDIT_EXAMPLE,
    inputSchema: CORTEX_ARTICLE_AUDIT_SCHEMA,
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
      readonly request: ReturnType<typeof decodeCortexArticleRequest>;
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
    path: '',
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
  return {
    kind: CortexArticleContractKind.Result,
    findings: auditCortexArticleStructure(request.request),
  };
}

export function blueprintForSkillRequest(
  value: UntrustedSkillYamlNode,
): string {
  if (
    isSkillYamlMap(value) &&
    Object.hasOwn(value, SkillRequestFamily.ToolsList)
  ) {
    return TOOLS_LIST_EXAMPLE;
  }
  return CORTEX_ARTICLE_AUDIT_EXAMPLE;
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
  if (
    keys.length !== 1 ||
    !list.found ||
    !isSkillYamlMap(list.value) ||
    Object.keys(list.value).length !== 0
  ) {
    const request: InvalidSkillRequest = {
      path: 'skillToolsList',
      message: 'Expected only the empty list action.',
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
  if (Object.keys(family.value).length !== 1 || !audit.found) {
    const request: InvalidSkillRequest = {
      path: 'cortexArticleStructure',
      message: 'Expected only the audit action.',
    };
    return invalidRequest(request);
  }
  try {
    return {
      ok: true,
      request: {
        family: SkillRequestFamily.CortexArticleStructure,
        operation: CortexArticleStructureOperation.Audit,
        request: decodeCortexArticleRequest(JSON.stringify(audit.value)),
      },
    };
  } catch (error) {
    const request: InvalidSkillRequest = {
      path: 'cortexArticleStructure.audit',
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
