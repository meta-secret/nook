import { expect, test } from 'bun:test';
import {
  AgentAttemptParentKind,
  LoomExtractionClassification,
  LoomExtractionTarget,
  StructuralAssessmentKind,
  StructuralExpertAuthorizationKind,
  StructuralFindingCategory,
  StructuralFindingDisposition,
  StructuralFindingSeverity,
  StructuralInstructionClassificationKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  CodeRefactoringTaskOutput,
  CortexRefactoringTaskOutput,
  LoomExtractionCandidate,
  StructuralFinding,
  StructuralFindingAssessment,
  StructuralInstructionClassification,
  StructuralExpertPlanTaskOutput,
  SystemCoherenceTaskOutput,
} from '../../src/agent-workflow/domain.ts';
import { isRecord } from '../../src/lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
} from '../../src/lib/guards.ts';
import {
  decodeWorkflowTaskOutput,
  workflowTaskOutputSchema,
} from '../../src/agent-workflow/structured-result-codec.ts';

test('decodes dedicated structural plan and evidence unions', () => {
  const outputs = [
    structuralPlan(),
    codeEvidence(),
    cortexEvidence(),
    coherenceSynthesis(),
  ];
  for (const output of outputs) {
    expect(decodeWorkflowTaskOutput(JSON.stringify(output))).toEqual(output);
  }
  const serializedPlan = JSON.stringify(structuralPlan());
  expect(serializedPlan).toContain('childLanes');
  expect(serializedPlan).not.toContain('resultSha256');
  expect(serializedPlan).not.toContain('viewSha256');
});

test('binds schemas to role-specific continuation vocabularies', () => {
  const codeSchema = workflowTaskOutputSchema(
    WorkflowResultKind.CodeRefactoringEvidence,
  );
  const cortexSchema = workflowTaskOutputSchema(
    WorkflowResultKind.CortexRefactoringEvidence,
  );
  const synthesisSchema = workflowTaskOutputSchema(
    WorkflowResultKind.SystemCoherenceSynthesis,
  );
  expect(JSON.stringify(codeSchema)).toContain('typeSafetyFindings');
  expect(JSON.stringify(codeSchema)).not.toContain('obsoleteClaims');
  expect(JSON.stringify(cortexSchema)).toContain('loomExtractionCandidates');
  expect(JSON.stringify(synthesisSchema)).toContain('coverageGaps');
  expect(JSON.stringify(synthesisSchema)).not.toContain('architectureFindings');
});

test('rejects incomplete evidence and depth-three structural authority', () => {
  const code = codeEvidence();
  const { parentActions: omittedParentActions, ...incompleteContinuation } =
    code.continuation;
  void omittedParentActions;
  const missing = { ...code, continuation: incompleteContinuation };
  expect(() => decodeWorkflowTaskOutput(JSON.stringify(missing))).toThrow(
    'missing or extra fields',
  );

  const plan = structuralPlan();
  const depthThree: StructuralExpertPlanTaskOutput = {
    ...plan,
    structuralExpertAuthorizations: plan.structuralExpertAuthorizations.map(
      (authorization) => ({ ...authorization, depth: 3 as 2 }),
    ),
  };
  expect(() => decodeWorkflowTaskOutput(JSON.stringify(depthThree))).toThrow(
    'depth is invalid',
  );
});

test('rejects malformed, duplicate, extra, and unbounded typed structural records', () => {
  const code = codeEvidence();
  const finding = structuralFindingFor(StructuralFindingCategory.Architecture)(
    'malformed-finding',
  );
  const invalidSeverity = {
    ...finding,
    severity: 'urgent' as StructuralFindingSeverity,
  };
  const extraFinding = { ...finding, extraAuthority: true };
  const malformedOutputs = [
    {
      ...code,
      continuation: {
        ...code.continuation,
        architectureFindings: findingsAssessment([invalidSeverity]),
      },
    },
    {
      ...code,
      continuation: {
        ...code.continuation,
        architectureFindings: findingsAssessment([extraFinding]),
      },
    },
    {
      ...code,
      continuation: {
        ...code.continuation,
        architectureFindings: findingsAssessment([finding]),
        designFindings: findingsAssessment([
          structuralFindingFor(StructuralFindingCategory.Design)(
            finding.findingId,
          ),
        ]),
      },
    },
    {
      ...code,
      continuation: {
        ...code.continuation,
        architectureFindings: {
          kind: StructuralAssessmentKind.Findings,
          findings: new Array(101).fill(finding),
        },
      },
    },
  ];
  for (const output of malformedOutputs) {
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(output))).toThrow(
      'Invalid workflow structured result',
    );
  }

  const cortex = cortexEvidence();
  const candidate = extractionCandidate();
  const { declaredOutputs: omittedOutputs, ...missingCandidateField } =
    candidate;
  void omittedOutputs;
  const missingCandidate = {
    ...cortex,
    continuation: {
      ...cortex.continuation,
      loomExtractionCandidates: [missingCandidateField],
    },
  };
  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(missingCandidate)),
  ).toThrow('missing or extra fields');

  const plan = structuralPlan();
  const synthesis = plan.structuralExpertAuthorizations.find(
    (authorization) =>
      authorization.kind ===
      StructuralExpertAuthorizationKind.VerifiedViewSynthesis,
  );
  if (
    !synthesis ||
    synthesis.kind !== StructuralExpertAuthorizationKind.VerifiedViewSynthesis
  ) {
    throw new Error('Synthesis authorization fixture is missing.');
  }
  const malformedLane = {
    ...synthesis,
    childLanes: [
      { ...synthesis.childLanes[0], resultSha256: 'forged' },
      ...synthesis.childLanes.slice(1),
    ],
  };
  const duplicateChildren = {
    ...synthesis,
    childLanes: [synthesis.childLanes[0], synthesis.childLanes[0]],
  };
  const unboundedChildren = {
    ...synthesis,
    childLanes: new Array(17).fill(synthesis.childLanes[0]),
  };
  for (const authorization of [
    malformedLane,
    duplicateChildren,
    unboundedChildren,
  ]) {
    const output = {
      ...plan,
      structuralExpertAuthorizations: [
        plan.structuralExpertAuthorizations[0],
        authorization,
      ],
    };
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(output))).toThrow(
      'Invalid workflow structured result',
    );
  }
});

type CategoryMismatchCase = {
  readonly field: string;
  readonly output: CodeRefactoringTaskOutput | CortexRefactoringTaskOutput;
  readonly wrongCategory: StructuralFindingCategory;
};

const CATEGORY_MISMATCH_CASES: readonly CategoryMismatchCase[] = [
  {
    field: 'architectureFindings',
    output: codeEvidence(),
    wrongCategory: StructuralFindingCategory.Design,
  },
  {
    field: 'designFindings',
    output: codeEvidence(),
    wrongCategory: StructuralFindingCategory.Architecture,
  },
  {
    field: 'codeQualityFindings',
    output: codeEvidence(),
    wrongCategory: StructuralFindingCategory.Tests,
  },
  {
    field: 'typeSafetyFindings',
    output: codeEvidence(),
    wrongCategory: StructuralFindingCategory.CodeQuality,
  },
  {
    field: 'testFindings',
    output: codeEvidence(),
    wrongCategory: StructuralFindingCategory.TypeSafety,
  },
  {
    field: 'dependencyDirectionFindings',
    output: codeEvidence(),
    wrongCategory: StructuralFindingCategory.Design,
  },
  {
    field: 'conflicts',
    output: cortexEvidence(),
    wrongCategory: StructuralFindingCategory.ObsoleteClaim,
  },
  {
    field: 'obsoleteClaims',
    output: cortexEvidence(),
    wrongCategory: StructuralFindingCategory.HistoricalClaim,
  },
  {
    field: 'historicalClaims',
    output: cortexEvidence(),
    wrongCategory: StructuralFindingCategory.Duplication,
  },
  {
    field: 'duplications',
    output: cortexEvidence(),
    wrongCategory: StructuralFindingCategory.Complexity,
  },
  {
    field: 'complexityFindings',
    output: cortexEvidence(),
    wrongCategory: StructuralFindingCategory.KnowledgeGraph,
  },
  {
    field: 'knowledgeGraphImpacts',
    output: cortexEvidence(),
    wrongCategory: StructuralFindingCategory.AuthorityConflict,
  },
];

test('rejects every categorized field when its finding category is mismatched', () => {
  for (const mismatch of CATEGORY_MISMATCH_CASES) {
    const malformed = mismatchedCategoryOutput(mismatch);
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(malformed))).toThrow(
      'closed vocabulary is invalid',
    );
  }
});

test('requires an explicit exact nonempty-findings or none-with-reason assessment', () => {
  const finding = structuralFindingFor(StructuralFindingCategory.Architecture)(
    'assessment-shape',
  );
  const variants: readonly UntrustedYamlMap[] = [
    { kind: StructuralAssessmentKind.Findings, findings: [] },
    {
      kind: StructuralAssessmentKind.Findings,
      findings: [finding],
      reason: 'Extra authority.',
    },
    { kind: StructuralAssessmentKind.None, reason: '' },
    {
      kind: StructuralAssessmentKind.None,
      reason: 'No issue found.',
      findings: [finding],
    },
    { kind: 'maybe', reason: 'Ambiguous assessment.' },
  ];
  for (const assessment of variants) {
    const replacementInput: AssessmentReplacementInput = {
      assessment,
      field: 'architectureFindings',
      output: codeEvidence(),
    };
    const malformed = replaceAssessment(replacementInput);
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(malformed))).toThrow(
      'Invalid workflow structured result',
    );
  }
});

function mismatchedCategoryOutput(
  input: CategoryMismatchCase,
): UntrustedYamlMap {
  const output = transportMap(input.output);
  const continuation = requiredTestMap(
    output.continuation as UntrustedYamlNode,
  );
  const assessment = requiredTestMap(
    continuation[input.field] as UntrustedYamlNode,
  );
  const findings = requiredTestSequence(
    assessment.findings as UntrustedYamlNode,
  );
  const first = requiredTestMap(findings[0] as UntrustedYamlNode);
  const replacement = {
    ...first,
    category: input.wrongCategory,
  };
  const replacementInput: AssessmentReplacementInput = {
    assessment: {
      ...assessment,
      findings: [replacement, ...findings.slice(1)],
    },
    field: input.field,
    output: input.output,
  };
  return replaceAssessment(replacementInput);
}

type AssessmentReplacementInput = {
  readonly assessment: UntrustedYamlMap;
  readonly field: string;
  readonly output: CodeRefactoringTaskOutput | CortexRefactoringTaskOutput;
};

function replaceAssessment(
  input: AssessmentReplacementInput,
): UntrustedYamlMap {
  const output = transportMap(input.output);
  const continuation = requiredTestMap(
    output.continuation as UntrustedYamlNode,
  );
  return {
    ...output,
    continuation: { ...continuation, [input.field]: input.assessment },
  };
}

function transportMap(
  value: CodeRefactoringTaskOutput | CortexRefactoringTaskOutput,
): UntrustedYamlMap {
  const node = JSON.parse(JSON.stringify(value)) as UntrustedYamlNode;
  return requiredTestMap(node);
}

function requiredTestMap(node: UntrustedYamlNode): UntrustedYamlMap {
  if (!isRecord(node)) {
    throw new Error('Test fixture map is missing.');
  }
  return node;
}

function requiredTestSequence(
  node: UntrustedYamlNode,
): readonly UntrustedYamlNode[] {
  if (!Array.isArray(node)) throw new Error('Test fixture array is missing.');
  return node;
}

function structuralPlan(): StructuralExpertPlanTaskOutput {
  return {
    resultKind: WorkflowResultKind.StructuralExpertPlan,
    summary: 'Structural lanes frozen.',
    materializedViewMarkdown: '# Structural plan\n\nFrozen.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    structuralExpertAuthorizations: [
      {
        kind: StructuralExpertAuthorizationKind.RepositoryEvidence,
        task: 'inspect-code',
        expert: 'code_refactoring_expert',
        attempt: 1,
        depth: 2,
        parent: {
          kind: AgentAttemptParentKind.AgentAttempt,
          task: 'plan-refactoring',
          agent: 'delivery-owner',
          attempt: 1,
        },
        evidencePaths: ['nook-app/nook-platform/nook-core'],
      },
      {
        kind: StructuralExpertAuthorizationKind.VerifiedViewSynthesis,
        task: 'synthesize-refactoring',
        expert: 'system_coherence_synthesizer',
        attempt: 1,
        depth: 2,
        parent: {
          kind: AgentAttemptParentKind.AgentAttempt,
          task: 'plan-refactoring',
          agent: 'delivery-owner',
          attempt: 1,
        },
        childLanes: [childLane('inspect-code'), childLane('inspect-cortex')],
      },
    ],
  };
}

function childLane(task: string) {
  return {
    task,
    expert:
      task === 'inspect-code'
        ? 'code_refactoring_expert'
        : 'cortex_refactoring_expert',
    attempt: 1,
  };
}

function codeEvidence(): CodeRefactoringTaskOutput {
  return {
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    summary: 'Code structure inspected.',
    materializedViewMarkdown: '# Code refactoring\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      scopeModules: ['nook-core'],
      acceptedExternalContracts: ['No external contract change.'],
      preservedBehaviorInvariants: ['Behavior remains stable.'],
      preservedSecurityInvariants: ['Secret boundaries remain stable.'],
      architectureFindings: findingAssessmentFor(
        StructuralFindingCategory.Architecture,
      )('code-architecture'),
      designFindings: findingAssessmentFor(StructuralFindingCategory.Design)(
        'code-design',
      ),
      codeQualityFindings: findingAssessmentFor(
        StructuralFindingCategory.CodeQuality,
      )('code-quality'),
      typeSafetyFindings: findingAssessmentFor(
        StructuralFindingCategory.TypeSafety,
      )('code-types'),
      testFindings: findingAssessmentFor(StructuralFindingCategory.Tests)(
        'code-tests',
      ),
      dependencyDirectionFindings: findingAssessmentFor(
        StructuralFindingCategory.DependencyDirection,
      )('code-dependencies'),
      proposedSlices: ['Strengthen the state type first.'],
      focusedValidation: ['rust:test'],
      risks: ['Serialization compatibility requires review.'],
      unresolvedDecisions: ['Delivery owner selects migration timing.'],
      parentActions: ['Review the bounded slice.'],
    },
  };
}

function cortexEvidence(): CortexRefactoringTaskOutput {
  return {
    resultKind: WorkflowResultKind.CortexRefactoringEvidence,
    summary: 'Cortex structure inspected.',
    materializedViewMarkdown: '# Cortex refactoring\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      authoritySet: ['One owning workflow.'],
      canonicalOwners: ['The specific workflow owns ordering.'],
      conflicts: findingAssessmentFor(
        StructuralFindingCategory.AuthorityConflict,
      )('cortex-conflict'),
      obsoleteClaims: findingAssessmentFor(
        StructuralFindingCategory.ObsoleteClaim,
      )('cortex-obsolete'),
      historicalClaims: findingAssessmentFor(
        StructuralFindingCategory.HistoricalClaim,
      )('cortex-history'),
      duplications: findingAssessmentFor(StructuralFindingCategory.Duplication)(
        'cortex-duplication',
      ),
      complexityFindings: findingAssessmentFor(
        StructuralFindingCategory.Complexity,
      )('cortex-complexity'),
      instructionClassifications: [instructionClassification()],
      loomExtractionCandidates: [extractionCandidate()],
      knowledgeGraphImpacts: findingAssessmentFor(
        StructuralFindingCategory.KnowledgeGraph,
      )('cortex-graph'),
      proposedSlices: ['Normalize the repeated procedure.'],
      risks: ['Do not erase rationale.'],
      unresolvedDecisions: ['Owner selects canonical wording.'],
      parentActions: ['Review authority selection.'],
    },
  };
}

type StructuralFindingInput<TCategory extends StructuralFindingCategory> = {
  readonly findingId: string;
  readonly category: TCategory;
};

function structuralFinding<TCategory extends StructuralFindingCategory>(
  input: StructuralFindingInput<TCategory>,
): StructuralFinding<TCategory> {
  return {
    findingId: input.findingId,
    category: input.category,
    severity: StructuralFindingSeverity.Medium,
    disposition: StructuralFindingDisposition.Simplify,
    summary: 'A bounded structural issue was observed.',
    evidence: [
      {
        path: 'agentic-ai/loom/src/agent-workflow/domain.ts',
        locator: 'StructuralFinding',
        observation: 'The structural contract is explicit.',
      },
    ],
    affectedPaths: ['agentic-ai/loom/src/agent-workflow/domain.ts'],
    currentOwner: 'agent-workflow',
    proposedOwner: 'agent-workflow',
    preservedInvariants: ['Typed evidence remains authoritative.'],
    validation: ['loom:verify'],
    unresolvedDecision: 'None because ownership is unchanged.',
  };
}

function structuralFindingFor<TCategory extends StructuralFindingCategory>(
  category: TCategory,
): (findingId: string) => StructuralFinding<TCategory> {
  return (findingId: string) => {
    const input: StructuralFindingInput<TCategory> = { findingId, category };
    return structuralFinding(input);
  };
}

function findingAssessmentFor<TCategory extends StructuralFindingCategory>(
  category: TCategory,
): (findingId: string) => StructuralFindingAssessment<TCategory> {
  return (findingId: string) =>
    findingsAssessment([structuralFindingFor(category)(findingId)]);
}

type FindingSequence<TCategory extends StructuralFindingCategory> = readonly [
  StructuralFinding<TCategory>,
  ...StructuralFinding<TCategory>[],
];

function findingsAssessment<TCategory extends StructuralFindingCategory>(
  findings: FindingSequence<TCategory>,
): StructuralFindingAssessment<TCategory> {
  return { kind: StructuralAssessmentKind.Findings, findings };
}

function instructionClassification(): StructuralInstructionClassification {
  return {
    instructionId: 'instruction-policy',
    classification: StructuralInstructionClassificationKind.SemanticPolicy,
    authorityPath: '.cortex/teams/ai/architecture/refactoring-experts.md',
    summary: 'Ownership selection remains semantic policy.',
    evidence: structuralFindingFor(StructuralFindingCategory.Architecture)(
      'instruction-evidence',
    ).evidence,
  };
}

function extractionCandidate(): LoomExtractionCandidate {
  return {
    candidateId: 'candidate-cortex-links',
    classification: LoomExtractionClassification.Deterministic,
    target: LoomExtractionTarget.LoomLeaf,
    summary: 'Check declared links mechanically.',
    declaredInputs: ['Cortex Markdown paths.'],
    declaredOutputs: ['Typed link findings.'],
    failureBehavior: ['Return bounded completed evidence.'],
    residualSemanticPolicy: ['The owner decides how to resolve a broken link.'],
    evidence: structuralFindingFor(StructuralFindingCategory.Architecture)(
      'extraction-evidence',
    ).evidence,
  };
}

function coherenceSynthesis(): SystemCoherenceTaskOutput {
  return {
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
    summary: 'Evidence reconciled.',
    materializedViewMarkdown: '# Coherence\n\nReconciled.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      consumedArtifacts: ['Code and Cortex views.'],
      coverageGaps: ['No module contract evidence was required.'],
      crossSurfaceInvariants: ['Policy and mechanism remain separate.'],
      contradictions: ['No contradiction remains.'],
      acceptedProposals: ['Accept the bounded code slice.'],
      rejectedProposals: ['Reject unproved deterministic extraction.'],
      orderedSlices: ['Code evidence before owner implementation.'],
      serializationPoints: ['Shared documents remain owner-only.'],
      validationMatrix: ['loom:verify covers runtime changes.'],
      unresolvedDecisions: ['Owner selects delivery cut.'],
      deliveryOwnerActions: ['Integrate accepted evidence.'],
    },
  };
}
