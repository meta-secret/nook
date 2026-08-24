import {
  AgentAttemptParentKind,
  StructuralExpertAuthorizationKind,
  StructuralFindingCategory,
  WorkflowArtifactKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import type {
  CodeRefactoringContinuation,
  CortexRefactoringContinuation,
  StructuralChildLanePreauthorization,
  StructuralExpertAuthorization,
  StructuralFinding,
  StructuralFindingAssessment,
  StructuralTaskOutput,
  SystemCoherenceContinuation,
  WorkflowArtifactReference,
  WorkflowFinding,
} from './domain.ts';
import { isRecord } from '../lib/guards.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';
import {
  assertExactStructuralKeys as assertExactKeys,
  assertUniqueStructuralIds as assertUniqueIds,
  boundedStructuralString as boundedString,
  boundedStructuralStrings as boundedStrings,
  positiveStructuralInteger as positiveInteger,
  requiredStructuralArray as requiredArray,
  requiredStructuralRecord as requiredRecord,
  safeStructuralId as safeId,
  safeStructuralPaths as safePaths,
  structuralEnumValue as enumValue,
  structuralProperty as property,
} from './structural-result-values.ts';
import type { UniqueStructuralIds as UniqueIdsRequest } from './structural-result-values.ts';
import {
  assertUniqueStructuralFindingIds,
  decodeStructuralExtractionCandidates,
  decodeStructuralFindingAssessment,
  decodeStructuralInstructionClassifications,
  structuralExtractionCandidateSchema,
  structuralFindingAssessmentSchemaForField,
  structuralFindingsFromAssessments,
  structuralInstructionClassificationSchema,
} from './structural-evidence-codec.ts';
import type { DecodeStructuralFindingAssessmentRequest } from './structural-evidence-codec.ts';

const MAX_ITEMS = 100;
const MAX_TEXT = 4096;
const MAX_VIEW = 65_536;
const MAX_AUTHORIZATIONS = 16;
const MAX_EVIDENCE_PATHS = 64;

const CODE_FIELDS = [
  'scopeModules',
  'acceptedExternalContracts',
  'preservedBehaviorInvariants',
  'preservedSecurityInvariants',
  'architectureFindings',
  'designFindings',
  'codeQualityFindings',
  'typeSafetyFindings',
  'testFindings',
  'dependencyDirectionFindings',
  'proposedSlices',
  'focusedValidation',
  'risks',
  'unresolvedDecisions',
  'parentActions',
] as const;

const CORTEX_FIELDS = [
  'authoritySet',
  'canonicalOwners',
  'conflicts',
  'obsoleteClaims',
  'historicalClaims',
  'duplications',
  'complexityFindings',
  'instructionClassifications',
  'loomExtractionCandidates',
  'knowledgeGraphImpacts',
  'proposedSlices',
  'risks',
  'unresolvedDecisions',
  'parentActions',
] as const;

const SYNTHESIS_FIELDS = [
  'consumedArtifacts',
  'coverageGaps',
  'crossSurfaceInvariants',
  'contradictions',
  'acceptedProposals',
  'rejectedProposals',
  'orderedSlices',
  'serializationPoints',
  'validationMatrix',
  'unresolvedDecisions',
  'deliveryOwnerActions',
] as const;

export type StructuralSchemaRequest = {
  readonly baseSchema: UntrustedYamlMap;
  readonly resultKind: WorkflowResultKind;
};

export type DecodeStructuralResultRequest = {
  readonly node: UntrustedYamlMap;
  readonly resultKind: WorkflowResultKind;
};

export function isStructuralResultKind(
  resultKind: WorkflowResultKind,
): boolean {
  return (
    resultKind === WorkflowResultKind.StructuralExpertPlan ||
    resultKind === WorkflowResultKind.CodeRefactoringEvidence ||
    resultKind === WorkflowResultKind.CortexRefactoringEvidence ||
    resultKind === WorkflowResultKind.SystemCoherenceSynthesis
  );
}

export function structuralTaskOutputSchema(
  request: StructuralSchemaRequest,
): UntrustedYamlMap {
  const plan = request.resultKind === WorkflowResultKind.StructuralExpertPlan;
  const continuation = plan
    ? false
    : structuralContinuationSchema(request.resultKind);
  return {
    ...request.baseSchema,
    required: [
      'resultKind',
      'summary',
      'materializedViewMarkdown',
      'findings',
      'notesForParent',
      'artifacts',
      plan ? 'structuralExpertAuthorizations' : 'continuation',
    ],
    properties: {
      ...(request.baseSchema.properties as UntrustedYamlMap),
      resultKind: { type: 'string', enum: [request.resultKind] },
      ...(plan
        ? { structuralExpertAuthorizations: authorizationListSchema() }
        : { continuation }),
    },
  };
}

export function decodeStructuralTaskOutput(
  request: DecodeStructuralResultRequest,
): StructuralTaskOutput {
  const plan = request.resultKind === WorkflowResultKind.StructuralExpertPlan;
  assertExactKeys([
    request.node,
    [
      'resultKind',
      'summary',
      'materializedViewMarkdown',
      'findings',
      'notesForParent',
      'artifacts',
      plan ? 'structuralExpertAuthorizations' : 'continuation',
    ],
  ]);
  const fields = decodeBaseFields(request.node);
  if (plan) {
    return {
      ...fields,
      resultKind: WorkflowResultKind.StructuralExpertPlan,
      structuralExpertAuthorizations: decodeAuthorizations(
        property([request.node, 'structuralExpertAuthorizations']),
      ),
    };
  }
  const continuationNode = property([request.node, 'continuation']);
  if (request.resultKind === WorkflowResultKind.CodeRefactoringEvidence) {
    return {
      ...fields,
      resultKind: WorkflowResultKind.CodeRefactoringEvidence,
      continuation: decodeCodeContinuation(continuationNode),
    };
  }
  if (request.resultKind === WorkflowResultKind.CortexRefactoringEvidence) {
    return {
      ...fields,
      resultKind: WorkflowResultKind.CortexRefactoringEvidence,
      continuation: decodeCortexContinuation(continuationNode),
    };
  }
  if (request.resultKind !== WorkflowResultKind.SystemCoherenceSynthesis) {
    invalid('structural result kind is invalid');
  }
  return {
    ...fields,
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
    continuation: decodeSynthesisContinuation(continuationNode),
  };
}

function structuralContinuationSchema(
  resultKind: WorkflowResultKind,
): UntrustedYamlMap {
  if (resultKind === WorkflowResultKind.CodeRefactoringEvidence) {
    const schemaRequest: TypedContinuationSchemaRequest = {
      fields: CODE_FIELDS,
      instructionFields: [],
      extractionFields: [],
    };
    return typedContinuationSchema(schemaRequest);
  }
  if (resultKind === WorkflowResultKind.CortexRefactoringEvidence) {
    const schemaRequest: TypedContinuationSchemaRequest = {
      fields: CORTEX_FIELDS,
      instructionFields: ['instructionClassifications'],
      extractionFields: ['loomExtractionCandidates'],
    };
    return typedContinuationSchema(schemaRequest);
  }
  if (resultKind === WorkflowResultKind.SystemCoherenceSynthesis) {
    return stringContinuationSchema(SYNTHESIS_FIELDS);
  }
  invalid('structural result schema kind is invalid');
}

type TypedContinuationSchemaRequest = {
  readonly fields: readonly string[];
  readonly instructionFields: readonly string[];
  readonly extractionFields: readonly string[];
};

function typedContinuationSchema(
  request: TypedContinuationSchemaRequest,
): UntrustedYamlMap {
  const properties = Object.fromEntries(
    request.fields.map((field) => {
      const findingSchema = structuralFindingAssessmentSchemaForField(field);
      if (findingSchema) return [field, findingSchema];
      if (request.instructionFields.includes(field)) {
        return [
          field,
          boundedArraySchema([
            structuralInstructionClassificationSchema(),
            0,
            MAX_ITEMS,
          ]),
        ];
      }
      if (request.extractionFields.includes(field)) {
        return [
          field,
          boundedArraySchema([
            structuralExtractionCandidateSchema(),
            0,
            MAX_ITEMS,
          ]),
        ];
      }
      return [field, stringSequenceSchema()];
    }),
  );
  return {
    type: 'object',
    additionalProperties: false,
    required: request.fields,
    properties,
  };
}

function stringContinuationSchema(fields: readonly string[]): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: fields,
    properties: Object.fromEntries(
      fields.map((field) => [field, stringSequenceSchema()]),
    ),
  };
}

function authorizationListSchema(): UntrustedYamlMap {
  return {
    type: 'array',
    minItems: 1,
    maxItems: MAX_AUTHORIZATIONS,
    uniqueItems: true,
    items: {
      oneOf: [evidenceAuthorizationSchema(), synthesisAuthorizationSchema()],
    },
  };
}

function authorizationFieldsSchema(): UntrustedYamlMap {
  return {
    task: boundedStringSchema(128),
    expert: boundedStringSchema(128),
    attempt: { type: 'integer', minimum: 1 },
    depth: { type: 'integer', enum: [2] },
    parent: parentSchema(),
  };
}

function evidenceAuthorizationSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'kind',
      'task',
      'expert',
      'attempt',
      'depth',
      'parent',
      'evidencePaths',
    ],
    properties: {
      ...authorizationFieldsSchema(),
      kind: {
        type: 'string',
        enum: [StructuralExpertAuthorizationKind.RepositoryEvidence],
      },
      evidencePaths: boundedArraySchema([
        boundedStringSchema(512),
        1,
        MAX_EVIDENCE_PATHS,
      ]),
    },
  };
}

function synthesisAuthorizationSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'kind',
      'task',
      'expert',
      'attempt',
      'depth',
      'parent',
      'childLanes',
    ],
    properties: {
      ...authorizationFieldsSchema(),
      kind: {
        type: 'string',
        enum: [StructuralExpertAuthorizationKind.VerifiedViewSynthesis],
      },
      childLanes: boundedArraySchema([childLaneSchema(), 2, 16]),
    },
  };
}

function parentSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'task', 'agent', 'attempt'],
    properties: {
      kind: { type: 'string', enum: [AgentAttemptParentKind.AgentAttempt] },
      task: boundedStringSchema(128),
      agent: boundedStringSchema(128),
      attempt: { type: 'integer', minimum: 1 },
    },
  };
}

function childLaneSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['task', 'expert', 'attempt'],
    properties: {
      task: boundedStringSchema(128),
      expert: boundedStringSchema(128),
      attempt: { type: 'integer', minimum: 1 },
    },
  };
}

type StructuralArraySchema = readonly [UntrustedYamlMap, number, number];
function boundedArraySchema(input: StructuralArraySchema): UntrustedYamlMap {
  const [items, minItems, maxItems] = input;
  return { type: 'array', minItems, maxItems, items };
}

function boundedStringSchema(maxLength: number): UntrustedYamlMap {
  return { type: 'string', minLength: 1, maxLength, pattern: '\\S' };
}

function enumSchema(values: readonly string[]): UntrustedYamlMap {
  return { type: 'string', enum: values };
}

function stringSequenceSchema(): UntrustedYamlMap {
  return boundedArraySchema([boundedStringSchema(MAX_TEXT), 1, MAX_ITEMS]);
}

type StructuralBaseFields = Omit<
  StructuralTaskOutput,
  'resultKind' | 'continuation' | 'structuralExpertAuthorizations'
>;

function decodeBaseFields(node: UntrustedYamlMap): StructuralBaseFields {
  const view = boundedString([
    property([node, 'materializedViewMarkdown']),
    MAX_VIEW,
  ]);
  return {
    summary: boundedString([property([node, 'summary']), MAX_TEXT]),
    materializedViewMarkdown: view,
    findings: decodeWorkflowFindings(property([node, 'findings'])),
    notesForParent: boundedStrings([property([node, 'notesForParent']), 0]),
    artifacts: decodeArtifacts(property([node, 'artifacts'])),
  };
}

function decodeCodeContinuation(
  node: UntrustedYamlNode,
): CodeRefactoringContinuation {
  const record = requiredRecord([node, 'code continuation']);
  assertExactKeys([record, CODE_FIELDS]);
  const architectureInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Architecture> =
    {
      node: property([record, 'architectureFindings']),
      expectedCategory: StructuralFindingCategory.Architecture,
    };
  const designInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Design> =
    {
      node: property([record, 'designFindings']),
      expectedCategory: StructuralFindingCategory.Design,
    };
  const codeQualityInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.CodeQuality> =
    {
      node: property([record, 'codeQualityFindings']),
      expectedCategory: StructuralFindingCategory.CodeQuality,
    };
  const typeSafetyInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.TypeSafety> =
    {
      node: property([record, 'typeSafetyFindings']),
      expectedCategory: StructuralFindingCategory.TypeSafety,
    };
  const testsInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Tests> =
    {
      node: property([record, 'testFindings']),
      expectedCategory: StructuralFindingCategory.Tests,
    };
  const dependenciesInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.DependencyDirection> =
    {
      node: property([record, 'dependencyDirectionFindings']),
      expectedCategory: StructuralFindingCategory.DependencyDirection,
    };
  const continuation: CodeRefactoringContinuation = {
    scopeModules: boundedStrings([property([record, 'scopeModules']), 1]),
    acceptedExternalContracts: boundedStrings([
      property([record, 'acceptedExternalContracts']),
      1,
    ]),
    preservedBehaviorInvariants: boundedStrings([
      property([record, 'preservedBehaviorInvariants']),
      1,
    ]),
    preservedSecurityInvariants: boundedStrings([
      property([record, 'preservedSecurityInvariants']),
      1,
    ]),
    architectureFindings: decodeStructuralFindingAssessment(architectureInput),
    designFindings: decodeStructuralFindingAssessment(designInput),
    codeQualityFindings: decodeStructuralFindingAssessment(codeQualityInput),
    typeSafetyFindings: decodeStructuralFindingAssessment(typeSafetyInput),
    testFindings: decodeStructuralFindingAssessment(testsInput),
    dependencyDirectionFindings:
      decodeStructuralFindingAssessment(dependenciesInput),
    proposedSlices: boundedStrings([property([record, 'proposedSlices']), 1]),
    focusedValidation: boundedStrings([
      property([record, 'focusedValidation']),
      1,
    ]),
    risks: boundedStrings([property([record, 'risks']), 1]),
    unresolvedDecisions: boundedStrings([
      property([record, 'unresolvedDecisions']),
      1,
    ]),
    parentActions: boundedStrings([property([record, 'parentActions']), 1]),
  };
  assertUniqueStructuralFindingIds(
    structuralFindingsFromAssessments([
      continuation.architectureFindings,
      continuation.designFindings,
      continuation.codeQualityFindings,
      continuation.typeSafetyFindings,
      continuation.testFindings,
      continuation.dependencyDirectionFindings,
    ]),
  );
  return continuation;
}

function decodeCortexContinuation(
  node: UntrustedYamlNode,
): CortexRefactoringContinuation {
  const record = requiredRecord([node, 'cortex continuation']);
  assertExactKeys([record, CORTEX_FIELDS]);
  const conflictsInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.AuthorityConflict> =
    {
      node: property([record, 'conflicts']),
      expectedCategory: StructuralFindingCategory.AuthorityConflict,
    };
  const obsoleteInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.ObsoleteClaim> =
    {
      node: property([record, 'obsoleteClaims']),
      expectedCategory: StructuralFindingCategory.ObsoleteClaim,
    };
  const historicalInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.HistoricalClaim> =
    {
      node: property([record, 'historicalClaims']),
      expectedCategory: StructuralFindingCategory.HistoricalClaim,
    };
  const duplicationsInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Duplication> =
    {
      node: property([record, 'duplications']),
      expectedCategory: StructuralFindingCategory.Duplication,
    };
  const complexityInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Complexity> =
    {
      node: property([record, 'complexityFindings']),
      expectedCategory: StructuralFindingCategory.Complexity,
    };
  const graphInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.KnowledgeGraph> =
    {
      node: property([record, 'knowledgeGraphImpacts']),
      expectedCategory: StructuralFindingCategory.KnowledgeGraph,
    };
  const continuation: CortexRefactoringContinuation = {
    authoritySet: boundedStrings([property([record, 'authoritySet']), 1]),
    canonicalOwners: boundedStrings([property([record, 'canonicalOwners']), 1]),
    conflicts: decodeStructuralFindingAssessment(conflictsInput),
    obsoleteClaims: decodeStructuralFindingAssessment(obsoleteInput),
    historicalClaims: decodeStructuralFindingAssessment(historicalInput),
    duplications: decodeStructuralFindingAssessment(duplicationsInput),
    complexityFindings: decodeStructuralFindingAssessment(complexityInput),
    instructionClassifications: decodeStructuralInstructionClassifications(
      property([record, 'instructionClassifications']),
    ),
    loomExtractionCandidates: decodeStructuralExtractionCandidates(
      property([record, 'loomExtractionCandidates']),
    ),
    knowledgeGraphImpacts: decodeStructuralFindingAssessment(graphInput),
    proposedSlices: boundedStrings([property([record, 'proposedSlices']), 1]),
    risks: boundedStrings([property([record, 'risks']), 1]),
    unresolvedDecisions: boundedStrings([
      property([record, 'unresolvedDecisions']),
      1,
    ]),
    parentActions: boundedStrings([property([record, 'parentActions']), 1]),
  };
  assertUniqueStructuralFindingIds(
    structuralFindingsFromAssessments([
      continuation.conflicts,
      continuation.obsoleteClaims,
      continuation.historicalClaims,
      continuation.duplications,
      continuation.complexityFindings,
      continuation.knowledgeGraphImpacts,
    ]),
  );
  return continuation;
}

function decodeSynthesisContinuation(
  node: UntrustedYamlNode,
): SystemCoherenceContinuation {
  const record = requiredRecord([node, 'synthesis continuation']);
  assertExactKeys([record, SYNTHESIS_FIELDS]);
  return Object.fromEntries(
    SYNTHESIS_FIELDS.map((field) => [
      field,
      boundedStrings([property([record, field]), 1]),
    ]),
  ) as SystemCoherenceContinuation;
}

function decodeAuthorizations(
  node: UntrustedYamlNode,
): readonly StructuralExpertAuthorization[] {
  const values = requiredArray([node, 1]);
  if (values.length > MAX_AUTHORIZATIONS)
    invalid('structural authorizations exceed bound');
  const authorizations = values.map((entry) => decodeAuthorization(entry));
  const uniqueRequest: UniqueIdsRequest = {
    ids: authorizations.map((value) => `${value.task}\u0000${value.attempt}`),
    label: 'structural authorization',
  };
  assertUniqueIds(uniqueRequest);
  return authorizations;
}

function decodeAuthorization(
  node: UntrustedYamlNode,
): StructuralExpertAuthorization {
  const record = requiredRecord([node, 'structural authorization']);
  const kind = enumValue([
    property([record, 'kind']),
    Object.values(StructuralExpertAuthorizationKind),
  ]);
  const common = decodeAuthorizationFields(record);
  if (kind === StructuralExpertAuthorizationKind.RepositoryEvidence) {
    assertExactKeys([
      record,
      ['kind', 'task', 'expert', 'attempt', 'depth', 'parent', 'evidencePaths'],
    ]);
    return {
      ...common,
      kind,
      evidencePaths: safePaths([property([record, 'evidencePaths']), 1]),
    };
  }
  assertExactKeys([
    record,
    ['kind', 'task', 'expert', 'attempt', 'depth', 'parent', 'childLanes'],
  ]);
  const childLanes = decodeChildLanes(property([record, 'childLanes']));
  return { ...common, kind, childLanes };
}

function decodeAuthorizationFields(record: UntrustedYamlMap) {
  const task = safeId(property([record, 'task']));
  const expert = safeId(property([record, 'expert']));
  const attempt = positiveInteger(property([record, 'attempt']));
  if (positiveInteger(property([record, 'depth'])) !== 2)
    invalid('structural authorization depth is invalid');
  const parentRecord = requiredRecord([
    property([record, 'parent']),
    'authorization parent',
  ]);
  assertExactKeys([parentRecord, ['kind', 'task', 'agent', 'attempt']]);
  const kind = boundedString([property([parentRecord, 'kind']), 128]);
  const parent = {
    kind: AgentAttemptParentKind.AgentAttempt,
    task: safeId(property([parentRecord, 'task'])),
    agent: safeId(property([parentRecord, 'agent'])),
    attempt: positiveInteger(property([parentRecord, 'attempt'])),
  } as const;
  if (
    kind !== AgentAttemptParentKind.AgentAttempt ||
    (task === parent.task && attempt === parent.attempt)
  )
    invalid('structural authorization identity is invalid');
  return { task, expert, attempt, depth: 2 as const, parent };
}

function decodeChildLanes(
  node: UntrustedYamlNode,
): readonly StructuralChildLanePreauthorization[] {
  const values = requiredArray([node, 2]);
  if (values.length > 16) invalid('child lane count is invalid');
  const childLanes = values.map((entry) => {
    const record = requiredRecord([entry, 'child lane']);
    assertExactKeys([record, ['task', 'expert', 'attempt']]);
    const task = safeId(property([record, 'task']));
    const expert = safeId(property([record, 'expert']));
    const attempt = positiveInteger(property([record, 'attempt']));
    return { task, expert, attempt };
  });
  const uniqueRequest: UniqueIdsRequest = {
    ids: childLanes.map((value) => `${value.task}\u0000${value.attempt}`),
    label: 'child lane',
  };
  assertUniqueIds(uniqueRequest);
  return childLanes;
}

function decodeWorkflowFindings(
  node: UntrustedYamlNode,
): readonly WorkflowFinding[] {
  return requiredArray([node, 0]).map((entry) => {
    const record = requiredRecord([entry, 'workflow finding']);
    assertExactKeys([
      record,
      ['severity', 'title', 'summary', 'evidence', 'affectedPaths'],
    ]);
    return {
      severity: enumValue([
        property([record, 'severity']),
        Object.values(WorkflowFindingSeverity),
      ]),
      title: boundedString([property([record, 'title']), MAX_TEXT]),
      summary: boundedString([property([record, 'summary']), MAX_TEXT]),
      evidence: boundedStrings([property([record, 'evidence']), 1]),
      affectedPaths: safePaths([property([record, 'affectedPaths']), 0]),
    };
  });
}

function decodeArtifacts(
  node: UntrustedYamlNode,
): readonly WorkflowArtifactReference[] {
  return requiredArray([node, 0]).map((entry) => {
    const record = requiredRecord([entry, 'workflow artifact']);
    assertExactKeys([record, ['kind', 'location', 'description']]);
    return {
      kind: enumValue([
        property([record, 'kind']),
        Object.values(WorkflowArtifactKind),
      ]),
      location: boundedString([property([record, 'location']), MAX_TEXT]),
      description: boundedString([property([record, 'description']), MAX_TEXT]),
    };
  });
}

function invalid(detail: string): never {
  throw new Error(`Invalid workflow structured result: ${detail}.`);
}
