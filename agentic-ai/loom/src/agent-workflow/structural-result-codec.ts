import { z } from 'zod';
import {
  AgentAttemptParentKind,
  StructuralAssessmentKind,
  StructuralExpertAuthorizationKind,
  StructuralFindingCategory,
  WorkflowArtifactKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import {
  StructuralEvidenceCodec,
  INSTRUCTION_CLASSIFICATIONS,
  EXTRACTION_CANDIDATES,
} from './structural-evidence-codec.ts';
import {
  STRUCTURAL_ID,
  STRUCTURAL_INTEGER,
  structuralError,
  structuralObjectError,
  structuralPaths,
  structuralStrings,
  structuralText,
} from './structural-result-values.ts';

const BASE = {
  summary: structuralText(),
  materializedViewMarkdown: structuralText(65_536),
  findings: z
    .array(
      z.strictObject(
        {
          severity: z.enum(
            WorkflowFindingSeverity,
            structuralError('structural closed vocabulary is invalid'),
          ),
          title: structuralText(),
          summary: structuralText(),
          evidence: structuralStrings(),
          affectedPaths: structuralPaths(0),
        },
        structuralObjectError,
      ),
      structuralError('structural result array is invalid'),
    )
    .max(100, 'structural result array is invalid'),
  notesForParent: structuralStrings(0),
  artifacts: z
    .array(
      z.strictObject(
        {
          kind: z.enum(
            WorkflowArtifactKind,
            structuralError('structural closed vocabulary is invalid'),
          ),
          location: structuralText(),
          description: structuralText(),
        },
        structuralObjectError,
      ),
      structuralError('structural result array is invalid'),
    )
    .max(100, 'structural result array is invalid'),
};
const AUTHORIZATION_FIELDS = {
  task: STRUCTURAL_ID,
  expert: STRUCTURAL_ID,
  attempt: STRUCTURAL_INTEGER,
  depth: z.literal(
    2,
    structuralError('structural authorization depth is invalid'),
  ),
  parent: z.strictObject(
    {
      kind: z.literal(
        AgentAttemptParentKind.AgentAttempt,
        structuralError('structural authorization identity is invalid'),
      ),
      task: STRUCTURAL_ID,
      agent: STRUCTURAL_ID,
      attempt: STRUCTURAL_INTEGER,
    },
    structuralObjectError,
  ),
};
const CHILD_LANES = z
  .array(
    z.strictObject(
      {
        task: STRUCTURAL_ID,
        expert: STRUCTURAL_ID,
        attempt: STRUCTURAL_INTEGER,
      },
      structuralObjectError,
    ),
    structuralError('structural result array is invalid'),
  )
  .min(2, 'structural result array is invalid')
  .max(16, 'child lane count is invalid')
  .refine(
    (values) =>
      new Set(values.map((value) => `${value.task}\u0000${value.attempt}`))
        .size === values.length,
    'child lane identifiers must be unique',
  );
const AUTHORIZATION = z
  .discriminatedUnion(
    'kind',
    [
      z.strictObject(
        {
          ...AUTHORIZATION_FIELDS,
          kind: z.literal(StructuralExpertAuthorizationKind.RepositoryEvidence),
          evidencePaths: structuralPaths(),
        },
        structuralObjectError,
      ),
      z.strictObject(
        {
          ...AUTHORIZATION_FIELDS,
          kind: z.literal(
            StructuralExpertAuthorizationKind.VerifiedViewSynthesis,
          ),
          childLanes: CHILD_LANES,
        },
        structuralObjectError,
      ),
    ],
    structuralError('structural closed vocabulary is invalid'),
  )
  .refine(
    (value) =>
      value.task !== value.parent.task ||
      value.attempt !== value.parent.attempt,
    'structural authorization identity is invalid',
  );
const AUTHORIZATIONS = z
  .array(AUTHORIZATION, structuralError('structural result array is invalid'))
  .min(1, 'structural result array is invalid')
  .max(16, 'structural authorizations exceed bound')
  .refine(
    (values) =>
      new Set(values.map((value) => `${value.task}\u0000${value.attempt}`))
        .size === values.length,
    'structural authorization identifiers must be unique',
  );

const CODE_ASSESSMENTS = {
  architectureFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.Architecture,
  ),
  designFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.Design,
  ),
  codeQualityFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.CodeQuality,
  ),
  typeSafetyFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.TypeSafety,
  ),
  testFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.Tests,
  ),
  dependencyDirectionFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.DependencyDirection,
  ),
};
const CORTEX_ASSESSMENTS = {
  conflicts: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.AuthorityConflict,
  ),
  obsoleteClaims: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.ObsoleteClaim,
  ),
  historicalClaims: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.HistoricalClaim,
  ),
  duplications: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.Duplication,
  ),
  complexityFindings: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.Complexity,
  ),
  knowledgeGraphImpacts: StructuralEvidenceCodec.findingAssessment(
    StructuralFindingCategory.KnowledgeGraph,
  ),
};
class StructuralFindingAssessmentSequence {
  constructor(
    private readonly assessments: readonly z.infer<
      ReturnType<typeof StructuralEvidenceCodec.findingAssessment>
    >[],
  ) {}

  hasUniqueFindingIds(): boolean {
    const ids = this.assessments.flatMap((assessment) =>
      assessment.kind === StructuralAssessmentKind.Findings
        ? assessment.findings.map((finding) => finding.findingId)
        : [],
    );
    return new Set(ids).size === ids.length;
  }
}
const CODE_CONTINUATION = z
  .strictObject(
    {
      scopeModules: structuralStrings(),
      acceptedExternalContracts: structuralStrings(),
      preservedBehaviorInvariants: structuralStrings(),
      preservedSecurityInvariants: structuralStrings(),
      ...CODE_ASSESSMENTS,
      proposedSlices: structuralStrings(),
      focusedValidation: structuralStrings(),
      risks: structuralStrings(),
      unresolvedDecisions: structuralStrings(),
      parentActions: structuralStrings(),
    },
    structuralObjectError,
  )
  .refine(
    (value) =>
      new StructuralFindingAssessmentSequence([
        value.architectureFindings,
        value.designFindings,
        value.codeQualityFindings,
        value.typeSafetyFindings,
        value.testFindings,
        value.dependencyDirectionFindings,
      ]).hasUniqueFindingIds(),
    'structural finding identifiers must be unique',
  );
const CORTEX_CONTINUATION = z
  .strictObject(
    {
      authoritySet: structuralStrings(),
      canonicalOwners: structuralStrings(),
      ...CORTEX_ASSESSMENTS,
      instructionClassifications: INSTRUCTION_CLASSIFICATIONS,
      loomExtractionCandidates: EXTRACTION_CANDIDATES,
      proposedSlices: structuralStrings(),
      risks: structuralStrings(),
      unresolvedDecisions: structuralStrings(),
      parentActions: structuralStrings(),
    },
    structuralObjectError,
  )
  .refine(
    (value) =>
      new StructuralFindingAssessmentSequence([
        value.conflicts,
        value.obsoleteClaims,
        value.historicalClaims,
        value.duplications,
        value.complexityFindings,
        value.knowledgeGraphImpacts,
      ]).hasUniqueFindingIds(),
    'structural finding identifiers must be unique',
  );
const SYNTHESIS_CONTINUATION = z.strictObject(
  {
    consumedArtifacts: structuralStrings(),
    coverageGaps: structuralStrings(),
    crossSurfaceInvariants: structuralStrings(),
    contradictions: structuralStrings(),
    acceptedProposals: structuralStrings(),
    rejectedProposals: structuralStrings(),
    orderedSlices: structuralStrings(),
    serializationPoints: structuralStrings(),
    validationMatrix: structuralStrings(),
    unresolvedDecisions: structuralStrings(),
    deliveryOwnerActions: structuralStrings(),
  },
  structuralObjectError,
);

export const STRUCTURAL_RESULT_SCHEMAS = {
  [WorkflowResultKind.StructuralExpertPlan]: z.strictObject(
    {
      ...BASE,
      resultKind: z.literal(WorkflowResultKind.StructuralExpertPlan),
      structuralExpertAuthorizations: AUTHORIZATIONS,
    },
    structuralObjectError,
  ),
  [WorkflowResultKind.CodeRefactoringEvidence]: z.strictObject(
    {
      ...BASE,
      resultKind: z.literal(WorkflowResultKind.CodeRefactoringEvidence),
      continuation: CODE_CONTINUATION,
    },
    structuralObjectError,
  ),
  [WorkflowResultKind.CortexRefactoringEvidence]: z.strictObject(
    {
      ...BASE,
      resultKind: z.literal(WorkflowResultKind.CortexRefactoringEvidence),
      continuation: CORTEX_CONTINUATION,
    },
    structuralObjectError,
  ),
  [WorkflowResultKind.SystemCoherenceSynthesis]: z.strictObject(
    {
      ...BASE,
      resultKind: z.literal(WorkflowResultKind.SystemCoherenceSynthesis),
      continuation: SYNTHESIS_CONTINUATION,
    },
    structuralObjectError,
  ),
};
export type DecodedStructuralTaskOutput = z.infer<
  (typeof STRUCTURAL_RESULT_SCHEMAS)[keyof typeof STRUCTURAL_RESULT_SCHEMAS]
>;
