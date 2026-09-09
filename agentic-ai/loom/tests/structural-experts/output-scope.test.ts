import { execFileSync } from 'node:child_process';

import { expect, test } from 'bun:test';

import {
  AgentAttemptParentKind,
  LoomExtractionClassification,
  LoomExtractionTarget,
  StructuralAssessmentKind,
  StructuralFindingCategory,
  StructuralFindingDisposition,
  StructuralFindingSeverity,
  StructuralInstructionClassificationKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';

import type {
  CodeRefactoringTaskOutput,
  CortexRefactoringTaskOutput,
  StructuralFinding,
} from '../../src/agent-workflow/domain.ts';

import {
  StructuralExpertKind,
  StructuralExpertCatalog,
} from '../../src/structural-experts/catalog.ts';

import { StructuralExpertOutputScope } from '../../src/structural-experts/output-scope.ts';

import type { ValidateStructuralOutputScopeRequest } from '../../src/structural-experts/output-scope.ts';

import type { StructuralEvidenceInvocationRequest } from '../../src/structural-experts/request-codec.ts';

import { resolve } from 'node:path';

export class StructuralExpertsOutputScopeScenario {
  private constructor(private readonly request: ScopedCodeOutputInput) {}

  static codeValidationRequest(
    input: ScopedCodeOutputInput,
  ): ValidateStructuralOutputScopeRequest {
    return new StructuralExpertsOutputScopeScenario(input).execute();
  }

  private execute(): ValidateStructuralOutputScopeRequest {
    const input = this.request;
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      'code_refactoring_expert',
    );
    if (!profile) throw new Error('Code profile is missing.');
    const requestInput: EvidenceRequestInput = {
      evidencePaths: [input.selectedPath],
      expert: 'code_refactoring_expert',
    };
    return {
      output: StructuralExpertsOutputScopeScenario.codeOutput(input),
      profile,
      repoRoot: REPO_ROOT,
      request:
        StructuralExpertsOutputScopeScenario.evidenceRequest(requestInput),
    };
  }

  static codeOutput(input: ScopedCodeOutputInput): CodeRefactoringTaskOutput {
    const findingInput: FindingInput = {
      affectedPath: input.affectedPath,
      category: StructuralFindingCategory.Architecture,
      evidencePath: input.evidencePath,
      findingId: 'architecture-scope',
    };
    return {
      resultKind: WorkflowResultKind.CodeRefactoringEvidence,
      summary: 'Code scope inspected.',
      materializedViewMarkdown: '# Code scope\n\nInspected.',
      findings: [],
      notesForParent: [],
      artifacts: [],
      continuation: {
        scopeModules: ['bounded-module'],
        acceptedExternalContracts: ['No contract change.'],
        preservedBehaviorInvariants: ['Behavior remains stable.'],
        preservedSecurityInvariants: ['Security remains stable.'],
        architectureFindings: {
          kind: StructuralAssessmentKind.Findings,
          findings: [
            StructuralExpertsOutputScopeScenario.finding(findingInput),
          ],
        },
        designFindings: StructuralExpertsOutputScopeScenario.noFindings(),
        codeQualityFindings: StructuralExpertsOutputScopeScenario.noFindings(),
        typeSafetyFindings: StructuralExpertsOutputScopeScenario.noFindings(),
        testFindings: StructuralExpertsOutputScopeScenario.noFindings(),
        dependencyDirectionFindings:
          StructuralExpertsOutputScopeScenario.noFindings(),
        proposedSlices: ['Keep the slice bounded.'],
        focusedValidation: ['loom:verify'],
        risks: ['No additional risk.'],
        unresolvedDecisions: ['No unresolved decision.'],
        parentActions: ['Review the evidence.'],
      },
    };
  }

  static cortexValidationRequest(
    input: CortexEvidenceInput,
  ): ValidateStructuralOutputScopeRequest {
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      'cortex_refactoring_expert',
    );
    if (!profile) throw new Error('Cortex profile is missing.');
    const requestInput: EvidenceRequestInput = {
      evidencePaths: ['Taskfile.yml'],
      expert: 'cortex_refactoring_expert',
    };
    return {
      output: StructuralExpertsOutputScopeScenario.cortexOutput(input),
      profile,
      repoRoot: REPO_ROOT,
      request:
        StructuralExpertsOutputScopeScenario.evidenceRequest(requestInput),
    };
  }

  static cortexOutput(input: CortexEvidenceInput): CortexRefactoringTaskOutput {
    return {
      resultKind: WorkflowResultKind.CortexRefactoringEvidence,
      summary: 'Cortex scope inspected.',
      materializedViewMarkdown: '# Cortex scope\n\nInspected.',
      findings: [],
      notesForParent: [],
      artifacts: [],
      continuation: {
        authoritySet: ['Taskfile authority.'],
        canonicalOwners: ['Taskfile owns the entrypoint.'],
        conflicts: StructuralExpertsOutputScopeScenario.noFindings(),
        obsoleteClaims: StructuralExpertsOutputScopeScenario.noFindings(),
        historicalClaims: StructuralExpertsOutputScopeScenario.noFindings(),
        duplications: StructuralExpertsOutputScopeScenario.noFindings(),
        complexityFindings: StructuralExpertsOutputScopeScenario.noFindings(),
        instructionClassifications: [
          {
            instructionId: 'instruction-scope',
            classification:
              StructuralInstructionClassificationKind.ProjectWorkflow,
            authorityPath: 'Taskfile.yml',
            summary: 'The instruction is classified.',
            evidence: [
              StructuralExpertsOutputScopeScenario.evidence(
                input.instructionEvidencePath,
              ),
            ],
          },
        ],
        loomExtractionCandidates: [
          {
            candidateId: 'extraction-scope',
            classification: LoomExtractionClassification.Deterministic,
            target: LoomExtractionTarget.TaskEntrypoint,
            summary: 'The candidate is classified.',
            declaredInputs: ['Task request.'],
            declaredOutputs: ['Typed result.'],
            failureBehavior: ['Fail closed.'],
            residualSemanticPolicy: ['Owner retains semantic policy.'],
            evidence: [
              StructuralExpertsOutputScopeScenario.evidence(
                input.extractionEvidencePath,
              ),
            ],
          },
        ],
        knowledgeGraphImpacts:
          StructuralExpertsOutputScopeScenario.noFindings(),
        proposedSlices: ['Keep the slice bounded.'],
        risks: ['No additional risk.'],
        unresolvedDecisions: ['No unresolved decision.'],
        parentActions: ['Review the evidence.'],
      },
    };
  }

  static evidenceRequest(
    input: EvidenceRequestInput,
  ): StructuralEvidenceInvocationRequest {
    return {
      kind: StructuralExpertKind.RepositoryEvidence,
      runId: 'scope-validation',
      expert: input.expert,
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-scope',
      attempt: 1,
      depth: 2,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'plan-scope',
        agent: 'delivery-owner',
        attempt: 1,
      },
      instruction: 'Inspect only the selected scope.',
      evidencePaths: input.evidencePaths,
    };
  }

  static finding(
    input: FindingInput,
  ): StructuralFinding<StructuralFindingCategory.Architecture> {
    return {
      findingId: input.findingId,
      category: input.category,
      severity: StructuralFindingSeverity.Medium,
      disposition: StructuralFindingDisposition.Simplify,
      summary: 'The evidence path is explicit.',
      evidence: [
        StructuralExpertsOutputScopeScenario.evidence(input.evidencePath),
      ],
      affectedPaths: [input.affectedPath],
      currentOwner: 'current-owner',
      proposedOwner: 'proposed-owner',
      preservedInvariants: ['Preserve behavior.'],
      validation: ['loom:verify'],
      unresolvedDecision: 'No unresolved decision.',
    };
  }

  static evidence(path: string) {
    return {
      path,
      locator: 'bounded-locator',
      observation: 'Tracked evidence was observed.',
    };
  }

  static noFindings() {
    return {
      kind: StructuralAssessmentKind.None,
      reason: 'The bounded assessment found no issue in this category.',
    } as const;
  }

  static currentSourceCommit(): string {
    const options = { cwd: REPO_ROOT, encoding: 'utf8' as const };
    return execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
  }
}

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

const SOURCE_COMMIT =
  StructuralExpertsOutputScopeScenario.currentSourceCommit();

test('accepts only tracked blobs included by exact or recursive snapshot selection', () => {
  const cases = [
    { selected: 'Taskfile.yml', cited: 'Taskfile.yml', accepted: true },
    {
      selected: 'agentic-ai/loom/src/agent-workflow/domain.ts',
      cited: 'agentic-ai/loom/src/agent-workflow/domain.ts',
      accepted: true,
    },
    {
      selected: 'agentic-ai/loom/src/agent-workflow/domain.ts',
      cited: 'agentic-ai/loom/src/agent-workflow/domain.ts/fake',
      accepted: false,
    },
    { selected: 'Taskfile.yml', cited: 'Taskfile.yml/fake', accepted: false },
    { selected: 'Taskfile.yml', cited: 'Cargo.toml', accepted: false },
  ] as const;
  for (const item of cases) {
    const input: ScopedCodeOutputInput = {
      affectedPath: 'Cargo.toml',
      evidencePath: item.cited,
      selectedPath: item.selected,
    };
    const validation =
      StructuralExpertsOutputScopeScenario.codeValidationRequest(input);
    if (item.accepted) {
      expect(() =>
        StructuralExpertOutputScope.validate(validation),
      ).not.toThrow();
    } else {
      expect(() => StructuralExpertOutputScope.validate(validation)).toThrow(
        'exceeds authorized scope',
      );
    }
  }
});

test('accepts tracked built-in context while leaving proposal paths unconstrained', () => {
  const input: ScopedCodeOutputInput = {
    affectedPath: 'future/proposed/module.ts',
    evidencePath: '.cortex/AGENTS.md',
    selectedPath: 'Taskfile.yml',
  };
  expect(() =>
    StructuralExpertOutputScope.validate(
      StructuralExpertsOutputScopeScenario.codeValidationRequest(input),
    ),
  ).not.toThrow();
});

test('binds instruction and extraction evidence to the same commit manifest', () => {
  const instructionInput: CortexEvidenceInput = {
    extractionEvidencePath: 'Taskfile.yml',
    instructionEvidencePath: 'Cargo.toml',
  };
  const instructionRequest =
    StructuralExpertsOutputScopeScenario.cortexValidationRequest(
      instructionInput,
    );
  expect(() =>
    StructuralExpertOutputScope.validate(instructionRequest),
  ).toThrow('exceeds authorized scope');
  const extractionInput: CortexEvidenceInput = {
    extractionEvidencePath: 'Cargo.toml',
    instructionEvidencePath: 'Taskfile.yml',
  };
  const extractionRequest =
    StructuralExpertsOutputScopeScenario.cortexValidationRequest(
      extractionInput,
    );
  expect(() => StructuralExpertOutputScope.validate(extractionRequest)).toThrow(
    'exceeds authorized scope',
  );
});

type ScopedCodeOutputInput = {
  readonly affectedPath: string;
  readonly evidencePath: string;
  readonly selectedPath: string;
};

type CortexEvidenceInput = {
  readonly extractionEvidencePath: string;
  readonly instructionEvidencePath: string;
};

type EvidenceRequestInput = {
  readonly evidencePaths: readonly string[];
  readonly expert: string;
};

type FindingInput = {
  readonly affectedPath: string;
  readonly category: StructuralFindingCategory.Architecture;
  readonly evidencePath: string;
  readonly findingId: string;
};
