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
  StructuralTaskOutput,
  SystemCoherenceContinuation,
  WorkflowArtifactReference,
  WorkflowFinding,
} from './domain.ts';

import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';
import { StructuralValueBoundary } from './structural-result-values.ts';
import type { UniqueStructuralIds as UniqueIdsRequest } from './structural-result-values.ts';
import { StructuralEvidenceSchema } from './structural-evidence-codec.ts';
import type { DecodeStructuralFindingAssessmentRequest } from './structural-evidence-codec.ts';

/** Owns the structural result schema registry and its capability transitions. */
export class StructuralResultSchema {
  private constructor() {}
  private static readonly MAX_ITEMS = 100;

  private static readonly MAX_TEXT = 4096;

  private static readonly MAX_VIEW = 65_536;

  private static readonly MAX_AUTHORIZATIONS = 16;

  private static readonly MAX_EVIDENCE_PATHS = 64;

  private static readonly CODE_FIELDS = [
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

  private static readonly CORTEX_FIELDS = [
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

  private static readonly SYNTHESIS_FIELDS = [
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

  static isStructuralResultKind(resultKind: WorkflowResultKind): boolean {
    return (
      resultKind === WorkflowResultKind.StructuralExpertPlan ||
      resultKind === WorkflowResultKind.CodeRefactoringEvidence ||
      resultKind === WorkflowResultKind.CortexRefactoringEvidence ||
      resultKind === WorkflowResultKind.SystemCoherenceSynthesis
    );
  }

  static structuralTaskOutputSchema(
    request: StructuralSchemaRequest,
  ): UntrustedYamlMap {
    const plan = request.resultKind === WorkflowResultKind.StructuralExpertPlan;
    const continuation = plan
      ? false
      : StructuralResultSchema.structuralContinuationSchema(request.resultKind);
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
          ? {
              structuralExpertAuthorizations:
                StructuralResultSchema.authorizationListSchema(),
            }
          : { continuation }),
      },
    };
  }

  static decodeStructuralTaskOutput(
    request: DecodeStructuralResultRequest,
  ): StructuralTaskOutput {
    const plan = request.resultKind === WorkflowResultKind.StructuralExpertPlan;
    StructuralValueBoundary.assertExactStructuralKeys([
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
    const fields = StructuralResultSchema.decodeBaseFields(request.node);
    if (plan) {
      return {
        ...fields,
        resultKind: WorkflowResultKind.StructuralExpertPlan,
        structuralExpertAuthorizations:
          StructuralResultSchema.decodeAuthorizations(
            StructuralValueBoundary.structuralProperty([
              request.node,
              'structuralExpertAuthorizations',
            ]),
          ),
      };
    }
    const continuationNode = StructuralValueBoundary.structuralProperty([
      request.node,
      'continuation',
    ]);
    if (request.resultKind === WorkflowResultKind.CodeRefactoringEvidence) {
      return {
        ...fields,
        resultKind: WorkflowResultKind.CodeRefactoringEvidence,
        continuation:
          StructuralResultSchema.decodeCodeContinuation(continuationNode),
      };
    }
    if (request.resultKind === WorkflowResultKind.CortexRefactoringEvidence) {
      return {
        ...fields,
        resultKind: WorkflowResultKind.CortexRefactoringEvidence,
        continuation:
          StructuralResultSchema.decodeCortexContinuation(continuationNode),
      };
    }
    if (request.resultKind !== WorkflowResultKind.SystemCoherenceSynthesis) {
      StructuralResultSchema.invalid('structural result kind is invalid');
    }
    return {
      ...fields,
      resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
      continuation:
        StructuralResultSchema.decodeSynthesisContinuation(continuationNode),
    };
  }

  private static structuralContinuationSchema(
    resultKind: WorkflowResultKind,
  ): UntrustedYamlMap {
    if (resultKind === WorkflowResultKind.CodeRefactoringEvidence) {
      const schemaRequest: TypedContinuationSchemaRequest = {
        fields: StructuralResultSchema.CODE_FIELDS,
        instructionFields: [],
        extractionFields: [],
      };
      return StructuralResultSchema.typedContinuationSchema(schemaRequest);
    }
    if (resultKind === WorkflowResultKind.CortexRefactoringEvidence) {
      const schemaRequest: TypedContinuationSchemaRequest = {
        fields: StructuralResultSchema.CORTEX_FIELDS,
        instructionFields: ['instructionClassifications'],
        extractionFields: ['loomExtractionCandidates'],
      };
      return StructuralResultSchema.typedContinuationSchema(schemaRequest);
    }
    if (resultKind === WorkflowResultKind.SystemCoherenceSynthesis) {
      return StructuralResultSchema.stringContinuationSchema(
        StructuralResultSchema.SYNTHESIS_FIELDS,
      );
    }
    StructuralResultSchema.invalid('structural result schema kind is invalid');
  }

  private static typedContinuationSchema(
    request: TypedContinuationSchemaRequest,
  ): UntrustedYamlMap {
    const properties = Object.fromEntries(
      request.fields.map((field) => {
        const findingSchema =
          StructuralEvidenceSchema.structuralFindingAssessmentSchemaForField(
            field,
          );
        if (findingSchema) return [field, findingSchema];
        if (request.instructionFields.includes(field)) {
          return [
            field,
            StructuralResultSchema.boundedArraySchema([
              StructuralEvidenceSchema.structuralInstructionClassificationSchema(),
              0,
              StructuralResultSchema.MAX_ITEMS,
            ]),
          ];
        }
        if (request.extractionFields.includes(field)) {
          return [
            field,
            StructuralResultSchema.boundedArraySchema([
              StructuralEvidenceSchema.structuralExtractionCandidateSchema(),
              0,
              StructuralResultSchema.MAX_ITEMS,
            ]),
          ];
        }
        return [field, StructuralResultSchema.stringSequenceSchema()];
      }),
    );
    return {
      type: 'object',
      additionalProperties: false,
      required: request.fields,
      properties,
    };
  }

  private static stringContinuationSchema(
    fields: readonly string[],
  ): UntrustedYamlMap {
    return {
      type: 'object',
      additionalProperties: false,
      required: fields,
      properties: Object.fromEntries(
        fields.map((field) => [
          field,
          StructuralResultSchema.stringSequenceSchema(),
        ]),
      ),
    };
  }

  private static authorizationListSchema(): UntrustedYamlMap {
    return {
      type: 'array',
      minItems: 1,
      maxItems: StructuralResultSchema.MAX_AUTHORIZATIONS,
      uniqueItems: true,
      items: {
        oneOf: [
          StructuralResultSchema.evidenceAuthorizationSchema(),
          StructuralResultSchema.synthesisAuthorizationSchema(),
        ],
      },
    };
  }

  private static authorizationFieldsSchema(): UntrustedYamlMap {
    return {
      task: StructuralResultSchema.boundedStringSchema(128),
      expert: StructuralResultSchema.boundedStringSchema(128),
      attempt: { type: 'integer', minimum: 1 },
      depth: { type: 'integer', enum: [2] },
      parent: StructuralResultSchema.parentSchema(),
    };
  }

  private static evidenceAuthorizationSchema(): UntrustedYamlMap {
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
        ...StructuralResultSchema.authorizationFieldsSchema(),
        kind: {
          type: 'string',
          enum: [StructuralExpertAuthorizationKind.RepositoryEvidence],
        },
        evidencePaths: StructuralResultSchema.boundedArraySchema([
          StructuralResultSchema.boundedStringSchema(512),
          1,
          StructuralResultSchema.MAX_EVIDENCE_PATHS,
        ]),
      },
    };
  }

  private static synthesisAuthorizationSchema(): UntrustedYamlMap {
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
        ...StructuralResultSchema.authorizationFieldsSchema(),
        kind: {
          type: 'string',
          enum: [StructuralExpertAuthorizationKind.VerifiedViewSynthesis],
        },
        childLanes: StructuralResultSchema.boundedArraySchema([
          StructuralResultSchema.childLaneSchema(),
          2,
          16,
        ]),
      },
    };
  }

  private static parentSchema(): UntrustedYamlMap {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'task', 'agent', 'attempt'],
      properties: {
        kind: { type: 'string', enum: [AgentAttemptParentKind.AgentAttempt] },
        task: StructuralResultSchema.boundedStringSchema(128),
        agent: StructuralResultSchema.boundedStringSchema(128),
        attempt: { type: 'integer', minimum: 1 },
      },
    };
  }

  private static childLaneSchema(): UntrustedYamlMap {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['task', 'expert', 'attempt'],
      properties: {
        task: StructuralResultSchema.boundedStringSchema(128),
        expert: StructuralResultSchema.boundedStringSchema(128),
        attempt: { type: 'integer', minimum: 1 },
      },
    };
  }

  private static boundedArraySchema(
    input: StructuralArraySchema,
  ): UntrustedYamlMap {
    const [items, minItems, maxItems] = input;
    return { type: 'array', minItems, maxItems, items };
  }

  private static boundedStringSchema(maxLength: number): UntrustedYamlMap {
    return { type: 'string', minLength: 1, maxLength, pattern: '\\S' };
  }

  private static enumSchema(values: readonly string[]): UntrustedYamlMap {
    return { type: 'string', enum: values };
  }

  private static stringSequenceSchema(): UntrustedYamlMap {
    return StructuralResultSchema.boundedArraySchema([
      StructuralResultSchema.boundedStringSchema(
        StructuralResultSchema.MAX_TEXT,
      ),
      1,
      StructuralResultSchema.MAX_ITEMS,
    ]);
  }

  private static decodeBaseFields(
    node: UntrustedYamlMap,
  ): StructuralBaseFields {
    const view = StructuralValueBoundary.boundedStructuralString([
      StructuralValueBoundary.structuralProperty([
        node,
        'materializedViewMarkdown',
      ]),
      StructuralResultSchema.MAX_VIEW,
    ]);
    return {
      summary: StructuralValueBoundary.boundedStructuralString([
        StructuralValueBoundary.structuralProperty([node, 'summary']),
        StructuralResultSchema.MAX_TEXT,
      ]),
      materializedViewMarkdown: view,
      findings: StructuralResultSchema.decodeWorkflowFindings(
        StructuralValueBoundary.structuralProperty([node, 'findings']),
      ),
      notesForParent: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([node, 'notesForParent']),
        0,
      ]),
      artifacts: StructuralResultSchema.decodeArtifacts(
        StructuralValueBoundary.structuralProperty([node, 'artifacts']),
      ),
    };
  }

  private static decodeCodeContinuation(
    node: UntrustedYamlNode,
  ): CodeRefactoringContinuation {
    const record = StructuralValueBoundary.requiredStructuralRecord([
      node,
      'code continuation',
    ]);
    StructuralValueBoundary.assertExactStructuralKeys([
      record,
      StructuralResultSchema.CODE_FIELDS,
    ]);
    const architectureInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Architecture> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'architectureFindings',
        ]),
        expectedCategory: StructuralFindingCategory.Architecture,
      };
    const designInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Design> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'designFindings',
        ]),
        expectedCategory: StructuralFindingCategory.Design,
      };
    const codeQualityInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.CodeQuality> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'codeQualityFindings',
        ]),
        expectedCategory: StructuralFindingCategory.CodeQuality,
      };
    const typeSafetyInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.TypeSafety> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'typeSafetyFindings',
        ]),
        expectedCategory: StructuralFindingCategory.TypeSafety,
      };
    const testsInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Tests> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'testFindings',
        ]),
        expectedCategory: StructuralFindingCategory.Tests,
      };
    const dependenciesInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.DependencyDirection> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'dependencyDirectionFindings',
        ]),
        expectedCategory: StructuralFindingCategory.DependencyDirection,
      };
    const continuation: CodeRefactoringContinuation = {
      scopeModules: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'scopeModules']),
        1,
      ]),
      acceptedExternalContracts:
        StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([
            record,
            'acceptedExternalContracts',
          ]),
          1,
        ]),
      preservedBehaviorInvariants:
        StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([
            record,
            'preservedBehaviorInvariants',
          ]),
          1,
        ]),
      preservedSecurityInvariants:
        StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([
            record,
            'preservedSecurityInvariants',
          ]),
          1,
        ]),
      architectureFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          architectureInput,
        ),
      designFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(designInput),
      codeQualityFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          codeQualityInput,
        ),
      typeSafetyFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          typeSafetyInput,
        ),
      testFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(testsInput),
      dependencyDirectionFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          dependenciesInput,
        ),
      proposedSlices: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'proposedSlices']),
        1,
      ]),
      focusedValidation: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([
          record,
          'focusedValidation',
        ]),
        1,
      ]),
      risks: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'risks']),
        1,
      ]),
      unresolvedDecisions: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([
          record,
          'unresolvedDecisions',
        ]),
        1,
      ]),
      parentActions: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'parentActions']),
        1,
      ]),
    };
    StructuralEvidenceSchema.assertUniqueStructuralFindingIds(
      StructuralEvidenceSchema.structuralFindingsFromAssessments([
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

  private static decodeCortexContinuation(
    node: UntrustedYamlNode,
  ): CortexRefactoringContinuation {
    const record = StructuralValueBoundary.requiredStructuralRecord([
      node,
      'cortex continuation',
    ]);
    StructuralValueBoundary.assertExactStructuralKeys([
      record,
      StructuralResultSchema.CORTEX_FIELDS,
    ]);
    const conflictsInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.AuthorityConflict> =
      {
        node: StructuralValueBoundary.structuralProperty([record, 'conflicts']),
        expectedCategory: StructuralFindingCategory.AuthorityConflict,
      };
    const obsoleteInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.ObsoleteClaim> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'obsoleteClaims',
        ]),
        expectedCategory: StructuralFindingCategory.ObsoleteClaim,
      };
    const historicalInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.HistoricalClaim> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'historicalClaims',
        ]),
        expectedCategory: StructuralFindingCategory.HistoricalClaim,
      };
    const duplicationsInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Duplication> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'duplications',
        ]),
        expectedCategory: StructuralFindingCategory.Duplication,
      };
    const complexityInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.Complexity> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'complexityFindings',
        ]),
        expectedCategory: StructuralFindingCategory.Complexity,
      };
    const graphInput: DecodeStructuralFindingAssessmentRequest<StructuralFindingCategory.KnowledgeGraph> =
      {
        node: StructuralValueBoundary.structuralProperty([
          record,
          'knowledgeGraphImpacts',
        ]),
        expectedCategory: StructuralFindingCategory.KnowledgeGraph,
      };
    const continuation: CortexRefactoringContinuation = {
      authoritySet: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'authoritySet']),
        1,
      ]),
      canonicalOwners: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'canonicalOwners']),
        1,
      ]),
      conflicts:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          conflictsInput,
        ),
      obsoleteClaims:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          obsoleteInput,
        ),
      historicalClaims:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          historicalInput,
        ),
      duplications:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          duplicationsInput,
        ),
      complexityFindings:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(
          complexityInput,
        ),
      instructionClassifications:
        StructuralEvidenceSchema.decodeStructuralInstructionClassifications(
          StructuralValueBoundary.structuralProperty([
            record,
            'instructionClassifications',
          ]),
        ),
      loomExtractionCandidates:
        StructuralEvidenceSchema.decodeStructuralExtractionCandidates(
          StructuralValueBoundary.structuralProperty([
            record,
            'loomExtractionCandidates',
          ]),
        ),
      knowledgeGraphImpacts:
        StructuralEvidenceSchema.decodeStructuralFindingAssessment(graphInput),
      proposedSlices: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'proposedSlices']),
        1,
      ]),
      risks: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'risks']),
        1,
      ]),
      unresolvedDecisions: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([
          record,
          'unresolvedDecisions',
        ]),
        1,
      ]),
      parentActions: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'parentActions']),
        1,
      ]),
    };
    StructuralEvidenceSchema.assertUniqueStructuralFindingIds(
      StructuralEvidenceSchema.structuralFindingsFromAssessments([
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

  private static decodeSynthesisContinuation(
    node: UntrustedYamlNode,
  ): SystemCoherenceContinuation {
    const record = StructuralValueBoundary.requiredStructuralRecord([
      node,
      'synthesis continuation',
    ]);
    StructuralValueBoundary.assertExactStructuralKeys([
      record,
      StructuralResultSchema.SYNTHESIS_FIELDS,
    ]);
    return Object.fromEntries(
      StructuralResultSchema.SYNTHESIS_FIELDS.map((field) => [
        field,
        StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([record, field]),
          1,
        ]),
      ]),
    ) as SystemCoherenceContinuation;
  }

  private static decodeAuthorizations(
    node: UntrustedYamlNode,
  ): readonly StructuralExpertAuthorization[] {
    const values = StructuralValueBoundary.requiredStructuralArray([node, 1]);
    if (values.length > StructuralResultSchema.MAX_AUTHORIZATIONS)
      StructuralResultSchema.invalid('structural authorizations exceed bound');
    const authorizations = values.map((entry) =>
      StructuralResultSchema.decodeAuthorization(entry),
    );
    const uniqueRequest: UniqueIdsRequest = {
      ids: authorizations.map((value) => `${value.task}\u0000${value.attempt}`),
      label: 'structural authorization',
    };
    StructuralValueBoundary.assertUniqueStructuralIds(uniqueRequest);
    return authorizations;
  }

  private static decodeAuthorization(
    node: UntrustedYamlNode,
  ): StructuralExpertAuthorization {
    const record = StructuralValueBoundary.requiredStructuralRecord([
      node,
      'structural authorization',
    ]);
    const kind = StructuralValueBoundary.structuralEnumValue([
      StructuralValueBoundary.structuralProperty([record, 'kind']),
      Object.values(StructuralExpertAuthorizationKind),
    ]);
    const common = StructuralResultSchema.decodeAuthorizationFields(record);
    if (kind === StructuralExpertAuthorizationKind.RepositoryEvidence) {
      StructuralValueBoundary.assertExactStructuralKeys([
        record,
        [
          'kind',
          'task',
          'expert',
          'attempt',
          'depth',
          'parent',
          'evidencePaths',
        ],
      ]);
      return {
        ...common,
        kind,
        evidencePaths: StructuralValueBoundary.safeStructuralPaths([
          StructuralValueBoundary.structuralProperty([record, 'evidencePaths']),
          1,
        ]),
      };
    }
    StructuralValueBoundary.assertExactStructuralKeys([
      record,
      ['kind', 'task', 'expert', 'attempt', 'depth', 'parent', 'childLanes'],
    ]);
    const childLanes = StructuralResultSchema.decodeChildLanes(
      StructuralValueBoundary.structuralProperty([record, 'childLanes']),
    );
    return { ...common, kind, childLanes };
  }

  private static decodeAuthorizationFields(record: UntrustedYamlMap) {
    const task = StructuralValueBoundary.safeStructuralId(
      StructuralValueBoundary.structuralProperty([record, 'task']),
    );
    const expert = StructuralValueBoundary.safeStructuralId(
      StructuralValueBoundary.structuralProperty([record, 'expert']),
    );
    const attempt = StructuralValueBoundary.positiveStructuralInteger(
      StructuralValueBoundary.structuralProperty([record, 'attempt']),
    );
    if (
      StructuralValueBoundary.positiveStructuralInteger(
        StructuralValueBoundary.structuralProperty([record, 'depth']),
      ) !== 2
    )
      StructuralResultSchema.invalid(
        'structural authorization depth is invalid',
      );
    const parentRecord = StructuralValueBoundary.requiredStructuralRecord([
      StructuralValueBoundary.structuralProperty([record, 'parent']),
      'authorization parent',
    ]);
    StructuralValueBoundary.assertExactStructuralKeys([
      parentRecord,
      ['kind', 'task', 'agent', 'attempt'],
    ]);
    const kind = StructuralValueBoundary.boundedStructuralString([
      StructuralValueBoundary.structuralProperty([parentRecord, 'kind']),
      128,
    ]);
    const parent = {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: StructuralValueBoundary.safeStructuralId(
        StructuralValueBoundary.structuralProperty([parentRecord, 'task']),
      ),
      agent: StructuralValueBoundary.safeStructuralId(
        StructuralValueBoundary.structuralProperty([parentRecord, 'agent']),
      ),
      attempt: StructuralValueBoundary.positiveStructuralInteger(
        StructuralValueBoundary.structuralProperty([parentRecord, 'attempt']),
      ),
    } as const;
    if (
      kind !== AgentAttemptParentKind.AgentAttempt ||
      (task === parent.task && attempt === parent.attempt)
    )
      StructuralResultSchema.invalid(
        'structural authorization identity is invalid',
      );
    return { task, expert, attempt, depth: 2 as const, parent };
  }

  private static decodeChildLanes(
    node: UntrustedYamlNode,
  ): readonly StructuralChildLanePreauthorization[] {
    const values = StructuralValueBoundary.requiredStructuralArray([node, 2]);
    if (values.length > 16)
      StructuralResultSchema.invalid('child lane count is invalid');
    const childLanes = values.map((entry) => {
      const record = StructuralValueBoundary.requiredStructuralRecord([
        entry,
        'child lane',
      ]);
      StructuralValueBoundary.assertExactStructuralKeys([
        record,
        ['task', 'expert', 'attempt'],
      ]);
      const task = StructuralValueBoundary.safeStructuralId(
        StructuralValueBoundary.structuralProperty([record, 'task']),
      );
      const expert = StructuralValueBoundary.safeStructuralId(
        StructuralValueBoundary.structuralProperty([record, 'expert']),
      );
      const attempt = StructuralValueBoundary.positiveStructuralInteger(
        StructuralValueBoundary.structuralProperty([record, 'attempt']),
      );
      return { task, expert, attempt };
    });
    const uniqueRequest: UniqueIdsRequest = {
      ids: childLanes.map((value) => `${value.task}\u0000${value.attempt}`),
      label: 'child lane',
    };
    StructuralValueBoundary.assertUniqueStructuralIds(uniqueRequest);
    return childLanes;
  }

  private static decodeWorkflowFindings(
    node: UntrustedYamlNode,
  ): readonly WorkflowFinding[] {
    return StructuralValueBoundary.requiredStructuralArray([node, 0]).map(
      (entry) => {
        const record = StructuralValueBoundary.requiredStructuralRecord([
          entry,
          'workflow finding',
        ]);
        StructuralValueBoundary.assertExactStructuralKeys([
          record,
          ['severity', 'title', 'summary', 'evidence', 'affectedPaths'],
        ]);
        return {
          severity: StructuralValueBoundary.structuralEnumValue([
            StructuralValueBoundary.structuralProperty([record, 'severity']),
            Object.values(WorkflowFindingSeverity),
          ]),
          title: StructuralValueBoundary.boundedStructuralString([
            StructuralValueBoundary.structuralProperty([record, 'title']),
            StructuralResultSchema.MAX_TEXT,
          ]),
          summary: StructuralValueBoundary.boundedStructuralString([
            StructuralValueBoundary.structuralProperty([record, 'summary']),
            StructuralResultSchema.MAX_TEXT,
          ]),
          evidence: StructuralValueBoundary.boundedStructuralStrings([
            StructuralValueBoundary.structuralProperty([record, 'evidence']),
            1,
          ]),
          affectedPaths: StructuralValueBoundary.safeStructuralPaths([
            StructuralValueBoundary.structuralProperty([
              record,
              'affectedPaths',
            ]),
            0,
          ]),
        };
      },
    );
  }

  private static decodeArtifacts(
    node: UntrustedYamlNode,
  ): readonly WorkflowArtifactReference[] {
    return StructuralValueBoundary.requiredStructuralArray([node, 0]).map(
      (entry) => {
        const record = StructuralValueBoundary.requiredStructuralRecord([
          entry,
          'workflow artifact',
        ]);
        StructuralValueBoundary.assertExactStructuralKeys([
          record,
          ['kind', 'location', 'description'],
        ]);
        return {
          kind: StructuralValueBoundary.structuralEnumValue([
            StructuralValueBoundary.structuralProperty([record, 'kind']),
            Object.values(WorkflowArtifactKind),
          ]),
          location: StructuralValueBoundary.boundedStructuralString([
            StructuralValueBoundary.structuralProperty([record, 'location']),
            StructuralResultSchema.MAX_TEXT,
          ]),
          description: StructuralValueBoundary.boundedStructuralString([
            StructuralValueBoundary.structuralProperty([record, 'description']),
            StructuralResultSchema.MAX_TEXT,
          ]),
        };
      },
    );
  }

  private static invalid(detail: string): never {
    throw new Error(`Invalid workflow structured result: ${detail}.`);
  }
}

export type StructuralSchemaRequest = {
  readonly baseSchema: UntrustedYamlMap;
  readonly resultKind: WorkflowResultKind;
};

export type DecodeStructuralResultRequest = {
  readonly node: UntrustedYamlMap;
  readonly resultKind: WorkflowResultKind;
};

type TypedContinuationSchemaRequest = {
  readonly fields: readonly string[];
  readonly instructionFields: readonly string[];
  readonly extractionFields: readonly string[];
};

type StructuralArraySchema = readonly [UntrustedYamlMap, number, number];

type StructuralBaseFields = Omit<
  StructuralTaskOutput,
  'resultKind' | 'continuation' | 'structuralExpertAuthorizations'
>;
