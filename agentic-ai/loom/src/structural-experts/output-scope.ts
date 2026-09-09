import {
  StructuralAssessmentKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';

import type {
  CodeRefactoringContinuation,
  CortexRefactoringContinuation,
  StructuralFinding,
  StructuralFindingAssessment,
  StructuralFindingCategory,
  StructuralTaskOutput,
} from '../agent-workflow/domain.ts';

import type { StructuralExpertProfile } from './catalog.ts';

import type { StructuralEvidenceInvocationRequest } from './request-codec.ts';

import { execFileSync } from 'node:child_process';

export class StructuralExpertOutputScope {
  private constructor(
    private readonly request: ValidateStructuralOutputScopeRequest,
  ) {}
  static validate(input: ValidateStructuralOutputScopeRequest): void {
    return new StructuralExpertOutputScope(input).execute();
  }
  private execute(): void {
    const input = this.request;
    if (input.output.resultKind === WorkflowResultKind.StructuralExpertPlan) {
      this.invalidScope();
    }
    if (
      input.output.resultKind === WorkflowResultKind.SystemCoherenceSynthesis
    ) {
      return;
    }
    const evidencePaths =
      input.output.resultKind === WorkflowResultKind.CodeRefactoringEvidence
        ? this.codeEvidencePaths(input.output.continuation)
        : this.cortexEvidencePaths(input.output.continuation);
    if (evidencePaths.length === 0) return;
    const manifest = this.materializedEvidenceManifest(input);
    if (evidencePaths.some((evidencePath) => !manifest.has(evidencePath))) {
      this.invalidScope();
    }
  }

  private codeEvidencePaths(
    continuation: CodeRefactoringContinuation,
  ): readonly string[] {
    return this.assessmentEvidencePaths([
      continuation.architectureFindings,
      continuation.designFindings,
      continuation.codeQualityFindings,
      continuation.typeSafetyFindings,
      continuation.testFindings,
      continuation.dependencyDirectionFindings,
    ]);
  }

  private cortexEvidencePaths(
    continuation: CortexRefactoringContinuation,
  ): readonly string[] {
    return [
      ...this.assessmentEvidencePaths([
        continuation.conflicts,
        continuation.obsoleteClaims,
        continuation.historicalClaims,
        continuation.duplications,
        continuation.complexityFindings,
        continuation.knowledgeGraphImpacts,
      ]),
      ...continuation.instructionClassifications.flatMap((classification) =>
        classification.evidence.map((evidence) => evidence.path),
      ),
      ...continuation.loomExtractionCandidates.flatMap((candidate) =>
        candidate.evidence.map((evidence) => evidence.path),
      ),
    ];
  }

  private assessmentEvidencePaths(
    assessments: readonly StructuralFindingAssessment<StructuralFindingCategory>[],
  ): readonly string[] {
    return assessments.flatMap((assessment) =>
      assessment.kind === StructuralAssessmentKind.Findings
        ? assessment.findings.flatMap((value) =>
            this.findingEvidencePaths(value),
          )
        : [],
    );
  }

  private findingEvidencePaths(finding: StructuralFinding): readonly string[] {
    return finding.evidence.map((evidence) => evidence.path);
  }

  private materializedEvidenceManifest(
    input: ValidateStructuralOutputScopeRequest,
  ): ReadonlySet<string> {
    const selectedPaths = [
      input.profile.skillPath,
      ...input.profile.requiredContextPaths,
      ...input.request.evidencePaths,
    ];
    const args = [
      'ls-tree',
      '-r',
      '-z',
      input.request.sourceCommit,
      '--',
      ...selectedPaths,
    ];
    const options = {
      cwd: input.repoRoot,
      encoding: 'utf8' as const,
      maxBuffer: 16 * 1024 * 1024,
    };
    let serialized: string;
    try {
      serialized = execFileSync('git', args, options);
    } catch {
      this.invalidScope();
    }
    return new Set(
      serialized
        .split('\u0000')
        .filter(
          (record) =>
            record.startsWith('100644 blob ') ||
            record.startsWith('100755 blob '),
        )
        .map((record) => record.slice(record.indexOf('\t') + 1))
        .filter((path) =>
          input.profile.excludedPaths.every(
            (excluded) => path !== excluded && !path.startsWith(`${excluded}/`),
          ),
        ),
    );
  }

  private invalidScope(): never {
    throw new Error(
      'Structural expert output evidence exceeds authorized scope.',
    );
  }
}

export type ValidateStructuralOutputScopeRequest = {
  readonly output: StructuralTaskOutput;
  readonly profile: StructuralExpertProfile;
  readonly repoRoot: string;
  readonly request: StructuralEvidenceInvocationRequest;
};
