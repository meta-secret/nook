import { existsSync } from 'node:fs';

import { join, normalize } from 'node:path';

import { WorkflowResultKind } from '../agent-workflow/domain.ts';

import { STRUCTURAL_EXPERT_CATALOG, StructuralExpertKind } from './catalog.ts';

import type { StructuralExpertProfile } from './catalog.ts';

export class StructuralExpertContract {
  private constructor(
    private readonly request: AuditStructuralExpertsRequest,
  ) {}

  static auditStructuralExperts(
    request: AuditStructuralExpertsRequest,
  ): StructuralExpertAuditReport {
    return new StructuralExpertContract(request).execute();
  }

  private execute(): StructuralExpertAuditReport {
    const request = this.request;
    const profileRequest: AuditStructuralExpertProfilesRequest = {
      ...request,
      profiles: STRUCTURAL_EXPERT_CATALOG,
    };
    return StructuralExpertContract.auditStructuralExpertProfiles(
      profileRequest,
    );
  }

  static auditStructuralExpertProfiles(
    request: AuditStructuralExpertProfilesRequest,
  ): StructuralExpertAuditReport {
    const findings: StructuralExpertAuditFinding[] = [];
    if (request.profiles.length !== EXPECTED_PROFILES.length) {
      const finding: StructuralExpertAuditFinding = {
        code: 'invalid-structural-profile-count',
        path: 'agentic-ai/loom/src/structural-experts/catalog.ts',
        message:
          'The structural expert catalog must contain exactly three roles.',
      };
      findings.push(finding);
    }
    for (const expected of EXPECTED_PROFILES) {
      const profile = request.profiles.find(
        (candidate) => candidate.name === expected.name,
      );
      if (!profile) {
        const finding: StructuralExpertAuditFinding = {
          code: 'missing-structural-profile',
          path: 'agentic-ai/loom/src/structural-experts/catalog.ts',
          message: `Missing exact structural expert profile ${expected.name}.`,
        };
        findings.push(finding);
        continue;
      }
      const expectationRequest: ProfileExpectationMatchRequest = {
        expected,
        profile,
      };
      if (
        !StructuralExpertContract.profileMatchesExpectation(expectationRequest)
      ) {
        const finding: StructuralExpertAuditFinding = {
          code: 'structural-profile-contract-drift',
          path: STRUCTURAL_EXPERT_CATALOG_PATH,
          message: `Structural expert profile ${expected.name} differs from its exact reviewed contract.`,
        };
        findings.push(finding);
      }
      const validationRequest: ValidateStructuralProfileRequest = {
        findings,
        profile,
        repoRoot: request.repoRoot,
      };
      StructuralExpertContract.validateProfile(validationRequest);
    }
    return {
      auditOk: findings.length === 0,
      profileCount: request.profiles.length,
      findings,
    };
  }

  private static profileMatchesExpectation(
    request: ProfileExpectationMatchRequest,
  ): boolean {
    const expected = request.expected;
    const profile = request.profile;
    const contextPaths: EqualStringsRequest = {
      left: profile.requiredContextPaths,
      right: expected.requiredContextPaths,
    };
    const evidenceFiles: EqualStringsRequest = {
      left: [...profile.allowedEvidenceFiles].sort(),
      right: [...expected.allowedEvidenceFiles].sort(),
    };
    const evidenceDescendantRoots: EqualStringsRequest = {
      left: [...profile.allowedEvidenceDescendantRoots].sort(),
      right: [...expected.allowedEvidenceDescendantRoots].sort(),
    };
    const excludedPaths: EqualStringsRequest = {
      left: [...profile.excludedPaths].sort(),
      right: [...expected.excludedPaths].sort(),
    };
    const validationSelectors: EqualStringsRequest = {
      left: [...profile.validationSelectors].sort(),
      right: [...expected.validationSelectors].sort(),
    };
    return (
      profile.resultKind === expected.resultKind &&
      profile.kind === expected.kind &&
      profile.skillPath === expected.skillPath &&
      StructuralExpertContract.equalStrings(contextPaths) &&
      StructuralExpertContract.equalStrings(evidenceFiles) &&
      StructuralExpertContract.equalStrings(evidenceDescendantRoots) &&
      StructuralExpertContract.equalStrings(excludedPaths) &&
      StructuralExpertContract.equalStrings(validationSelectors)
    );
  }

  private static equalStrings(request: EqualStringsRequest): boolean {
    return JSON.stringify(request.left) === JSON.stringify(request.right);
  }

  private static validateProfile(
    request: ValidateStructuralProfileRequest,
  ): void {
    const { findings, profile, repoRoot } = request;
    const expectedSkills = new Map([
      [
        'code_refactoring_expert',
        '.cortex/teams/ai/dynamic-skills/code-refactoring-expert.md',
      ],
      [
        'cortex_refactoring_expert',
        '.cortex/teams/ai/dynamic-skills/cortex-refactoring-expert.md',
      ],
      [
        'system_coherence_synthesizer',
        '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
      ],
    ]);
    const expectedSkill = expectedSkills.get(profile.name);
    if (!expectedSkill || profile.skillPath !== expectedSkill) {
      const finding: StructuralExpertAuditFinding = {
        code: 'noncanonical-structural-profile-path',
        path: profile.skillPath,
        message: 'Structural expert skills require canonical paths.',
      };
      findings.push(finding);
    }
    const paths = [
      profile.skillPath,
      ...profile.requiredContextPaths,
      ...profile.allowedEvidenceFiles,
      ...profile.allowedEvidenceDescendantRoots,
      ...profile.excludedPaths,
    ];
    for (const path of paths) {
      if (!StructuralExpertContract.safeRepositoryPath(path)) {
        const finding: StructuralExpertAuditFinding = {
          code: 'unsafe-structural-profile-path',
          path,
          message:
            'Structural expert paths must be normalized and repository-relative.',
        };
        findings.push(finding);
      }
    }
    for (const path of [
      profile.skillPath,
      ...profile.requiredContextPaths,
      ...profile.allowedEvidenceFiles,
      ...profile.allowedEvidenceDescendantRoots,
    ]) {
      if (!existsSync(join(repoRoot, path))) {
        const finding: StructuralExpertAuditFinding = {
          code: 'missing-structural-profile-path',
          path,
          message: `Structural expert path does not exist: ${path}`,
        };
        findings.push(finding);
      }
    }
    if (profile.validationSelectors.length === 0) {
      const finding: StructuralExpertAuditFinding = {
        code: 'missing-structural-validation',
        path: STRUCTURAL_EXPERT_CATALOG_PATH,
        message:
          'Every structural expert requires focused validation selectors.',
      };
      findings.push(finding);
    }
    StructuralExpertContract.validateRoleIsolation(request);
  }

  private static validateRoleIsolation(
    request: ValidateStructuralProfileRequest,
  ): void {
    const profile = request.profile;
    const synthesis =
      profile.kind === StructuralExpertKind.VerifiedViewSynthesis;
    if (
      synthesis !== (profile.name === 'system_coherence_synthesizer') ||
      (synthesis &&
        (profile.allowedEvidenceFiles.length !== 0 ||
          profile.allowedEvidenceDescendantRoots.length !== 0 ||
          profile.requiredContextPaths.length !== 0 ||
          profile.excludedPaths.length !== 0 ||
          profile.runtimeBehaviorContract === '')) ||
      (!synthesis && profile.runtimeBehaviorContract !== '') ||
      (!synthesis &&
        profile.allowedEvidenceFiles.length === 0 &&
        profile.allowedEvidenceDescendantRoots.length === 0)
    ) {
      const finding: StructuralExpertAuditFinding = {
        code: 'invalid-structural-role-isolation',
        path: STRUCTURAL_EXPERT_CATALOG_PATH,
        message:
          'Repository evidence experts require bounded repository scope; legacy diagnostic aggregation must remain repository-blind and use verified terminal observations only.',
      };
      request.findings.push(finding);
    }
  }

  static safeRepositoryPath(path: string): boolean {
    return (
      path !== '' &&
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes('\u0000') &&
      !path.split('/').includes('..') &&
      normalize(path) === path
    );
  }
}

export type StructuralExpertAuditFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type StructuralExpertAuditReport = {
  readonly auditOk: boolean;
  readonly profileCount: number;
  readonly findings: readonly StructuralExpertAuditFinding[];
};

export type AuditStructuralExpertsRequest = {
  readonly repoRoot: string;
};

export type AuditStructuralExpertProfilesRequest =
  AuditStructuralExpertsRequest & {
    readonly profiles: readonly StructuralExpertProfile[];
  };

const EXPECTED_PROFILES = [
  {
    name: 'code_refactoring_expert',
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    kind: StructuralExpertKind.RepositoryEvidence,
    skillPath: '.cortex/teams/ai/dynamic-skills/code-refactoring-expert.md',
    requiredContextPaths: [
      '.cortex/AGENTS.md',
      '.cortex/index.md',
      '.cortex/teams/ai/docs/architecture/refactoring-experts.md',
      '.cortex/teams/ai/workflows/structural-refactoring.md',
      '.cortex/docs/spec/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'Taskfile.yml',
      '.github/formatting/format.sh',
      'agentic-ai/loom/.oxlintrc.json',
      'agentic-ai/loom/package.json',
    ],
    allowedEvidenceDescendantRoots: [
      '.github/scripts',
      '.github/workflows',
      '.task',
      'agentic-ai/loom/src',
      'agentic-ai/loom/tests',
      'nook-app/nook-platform',
      'nook-app/nook-web',
    ],
    excludedPaths: [
      'nook-app/nook-web/nook-web-research',
      'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm',
      'nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm',
    ],
    validationSelectors: [
      'preflight:source-architecture',
      'preflight:typescript-state',
      'loom:verify',
    ],
  },
  {
    name: 'cortex_refactoring_expert',
    resultKind: WorkflowResultKind.CortexRefactoringEvidence,
    kind: StructuralExpertKind.RepositoryEvidence,
    skillPath: '.cortex/teams/ai/dynamic-skills/cortex-refactoring-expert.md',
    requiredContextPaths: [
      '.cortex/AGENTS.md',
      '.cortex/index.md',
      '.cortex/teams/ai/docs/architecture/refactoring-experts.md',
      '.cortex/teams/ai/workflows/structural-refactoring.md',
      '.cortex/docs/spec/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'README.md',
      'Taskfile.yml',
      'agentic-ai/loom/src/codec/args/cortex-audit.ts',
      'agentic-ai/loom/src/commands/cortex-audit.ts',
      'agentic-ai/loom/src/lib/cortex-article-structure.ts',
      '.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts',
      '.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-index.ts',
      'agentic-ai/loom/tests/cortex-article-structure.test.ts',
      'agentic-ai/loom/tests/cortex-audit-session.test.ts',
      '.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/tests/cortex-document-structure.test.ts',
      '.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/tests/cortex-index.test.ts',
    ],
    allowedEvidenceDescendantRoots: [
      'agentic-ai/loom/.cortex',
      'nook-app/.cortex',
      'nook-app/nook-platform/.cortex',
      'nook-app/nook-platform/nook-auth2/.cortex',
      'nook-app/nook-platform/nook-companion-core/.cortex',
      'nook-app/nook-platform/nook-core/.cortex',
      'nook-app/nook-platform/nook-event-log/.cortex',
      'nook-app/nook-web/.cortex',
      'nook-app/nook-web/nook-web-extension/.cortex',
      '.cortex',
      '.github/workflows',
      '.task',
    ],
    excludedPaths: [
      '.cortex/.session',
      'agentic-ai/loom/.cortex/.session',
      'nook-app/.cortex/.session',
      'nook-app/nook-platform/.cortex/.session',
      'nook-app/nook-platform/nook-auth2/.cortex/.session',
      'nook-app/nook-platform/nook-companion-core/.cortex/.session',
      'nook-app/nook-platform/nook-core/.cortex/.session',
      'nook-app/nook-platform/nook-event-log/.cortex/.session',
      'nook-app/nook-web/.cortex/.session',
      'nook-app/nook-web/nook-web-extension/.cortex/.session',
    ],
    validationSelectors: ['loom:cortex-audit', 'loom:verify'],
  },
  {
    name: 'system_coherence_synthesizer',
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    skillPath:
      '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
    requiredContextPaths: [],
    allowedEvidenceFiles: [],
    allowedEvidenceDescendantRoots: [],
    excludedPaths: [],
    validationSelectors: ['loom:verify'],
  },
] as const;

const STRUCTURAL_EXPERT_CATALOG_PATH =
  'agentic-ai/loom/src/structural-experts/catalog.ts';

type StructuralExpertExpectation = (typeof EXPECTED_PROFILES)[number];

type ProfileExpectationMatchRequest = {
  readonly expected: StructuralExpertExpectation;
  readonly profile: StructuralExpertProfile;
};

type EqualStringsRequest = {
  readonly left: readonly string[];
  readonly right: readonly string[];
};

type ValidateStructuralProfileRequest = {
  readonly findings: StructuralExpertAuditFinding[];
  readonly profile: StructuralExpertProfile;
  readonly repoRoot: string;
};
