import { existsSync, readFileSync } from 'node:fs';

import { join, normalize } from 'node:path';

import { WorkflowResultKind } from '../agent-workflow/domain.ts';

import {
  STRUCTURAL_EXPERT_CATALOG,
  StructuralExpertKind,
  SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
} from './catalog.ts';

import type { StructuralExpertProfile } from './catalog.ts';

import { MarkdownContractSections } from '../lib/markdown-contract.ts';

import type {
  MarkdownContractAuditRequest,
  MarkdownContractSection,
} from '../lib/markdown-contract.ts';

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
    const authorityPath = join(
      request.repoRoot,
      STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
    );
    const registrySource = existsSync(authorityPath)
      ? readFileSync(authorityPath, 'utf8')
      : '';
    const skillPath = join(
      request.repoRoot,
      SYSTEM_COHERENCE_SKILL_AUTHORITY_PATH,
    );
    const skillSource = existsSync(skillPath)
      ? readFileSync(skillPath, 'utf8')
      : '';
    const workflowPath = join(
      request.repoRoot,
      STRUCTURAL_REFACTORING_WORKFLOW_AUTHORITY_PATH,
    );
    const workflowSource = existsSync(workflowPath)
      ? readFileSync(workflowPath, 'utf8')
      : '';
    const authorityRequest: AuditStructuralExpertCortexAuthorityRequest = {
      registrySource,
      skillSource,
      workflowSource,
    };
    findings.push(
      ...StructuralExpertContract.auditStructuralExpertCortexAuthority(
        authorityRequest,
      ),
    );
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
      left: profile.allowedEvidenceFiles,
      right: expected.allowedEvidenceFiles,
    };
    const evidenceDescendantRoots: EqualStringsRequest = {
      left: profile.allowedEvidenceDescendantRoots,
      right: expected.allowedEvidenceDescendantRoots,
    };
    const excludedPaths: EqualStringsRequest = {
      left: profile.excludedPaths,
      right: expected.excludedPaths,
    };
    const validationSelectors: EqualStringsRequest = {
      left: profile.validationSelectors,
      right: expected.validationSelectors,
    };
    return (
      profile.description === expected.description &&
      profile.resultKind === expected.resultKind &&
      profile.kind === expected.kind &&
      profile.skillPath === expected.skillPath &&
      profile.runtimeBehaviorContract === expected.runtimeBehaviorContract &&
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

  static auditStructuralExpertCortexAuthority(
    request: AuditStructuralExpertCortexAuthorityRequest,
  ): readonly StructuralExpertAuditFinding[] {
    const findings: StructuralExpertAuditFinding[] = [];
    const registryAuditRequest: AuditAuthorityContractRequest = {
      findings,
      path: STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
      sections: STRUCTURAL_EXPERT_REGISTRY_CONTRACT_SECTIONS,
      source: request.registrySource,
    };
    StructuralExpertContract.auditAuthorityContract(registryAuditRequest);
    const skillAuditRequest: AuditAuthorityContractRequest = {
      findings,
      path: SYSTEM_COHERENCE_SKILL_AUTHORITY_PATH,
      sections: SYSTEM_COHERENCE_SKILL_CONTRACT_SECTIONS,
      source: request.skillSource,
    };
    StructuralExpertContract.auditAuthorityContract(skillAuditRequest);
    const workflowAuditRequest: AuditAuthorityContractRequest = {
      findings,
      path: STRUCTURAL_REFACTORING_WORKFLOW_AUTHORITY_PATH,
      sections: STRUCTURAL_REFACTORING_WORKFLOW_CONTRACT_SECTIONS,
      source: request.workflowSource,
    };
    StructuralExpertContract.auditAuthorityContract(workflowAuditRequest);
    for (const profile of STRUCTURAL_EXPERT_CATALOG) {
      const marker = `## \`${profile.name}\``;
      if (request.registrySource.includes(marker)) continue;
      const finding: StructuralExpertAuditFinding = {
        code: 'missing-cortex-structural-expert-role',
        path: STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
        message: `Canonical Cortex structural expert role is missing: ${profile.name}`,
      };
      findings.push(finding);
    }
    return findings;
  }

  private static auditAuthorityContract(
    request: AuditAuthorityContractRequest,
  ): void {
    const contractAuditRequest: MarkdownContractAuditRequest = {
      sections: request.sections,
      source: request.source,
    };
    for (const drift of MarkdownContractSections.audit(contractAuditRequest)) {
      const finding: StructuralExpertAuditFinding = {
        code: 'cortex-structural-expert-contract-semantic-drift',
        path: request.path,
        message: `Canonical Cortex structural expert contract drifted in ${drift.heading}: ${drift.missingMarkers.join(', ')}`,
      };
      request.findings.push(finding);
    }
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

export type AuditStructuralExpertCortexAuthorityRequest = {
  readonly registrySource: string;
  readonly skillSource: string;
  readonly workflowSource: string;
};

const EXPECTED_PROFILES = [
  {
    name: 'code_refactoring_expert',
    description:
      'Read-only evidence expert for architecture, design, code quality, stronger types, and tests in explicitly authorized code scopes.',
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    kind: StructuralExpertKind.RepositoryEvidence,
    skillPath: '.cortex/teams/ai/dynamic-skills/code-refactoring-expert.md',
    requiredContextPaths: [
      '.cortex/AGENTS.md',
      '.cortex/knowledge-graph.md',
      '.cortex/teams/ai/architecture/refactoring-experts.md',
      '.cortex/teams/ai/workflows/structural-refactoring.md',
      '.cortex/gizmo-prime/workflows/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'Taskfile.yml',
      '.github/formatting/format.sh',
      'agentic-ai/loom/eslint.config.js',
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
    runtimeBehaviorContract: '',
    validationSelectors: [
      'preflight:source-architecture',
      'preflight:typescript-state',
      'loom:verify',
    ],
  },
  {
    name: 'cortex_refactoring_expert',
    description:
      'Read-only evidence expert for Cortex authority, conflicts, legacy content, complexity, and deterministic Loom extraction candidates.',
    resultKind: WorkflowResultKind.CortexRefactoringEvidence,
    kind: StructuralExpertKind.RepositoryEvidence,
    skillPath: '.cortex/teams/ai/dynamic-skills/cortex-refactoring-expert.md',
    requiredContextPaths: [
      '.cortex/AGENTS.md',
      '.cortex/knowledge-graph.md',
      '.cortex/teams/ai/architecture/refactoring-experts.md',
      '.cortex/teams/ai/workflows/structural-refactoring.md',
      '.cortex/gizmo-prime/workflows/subagent-delegation.md',
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
    allowedEvidenceDescendantRoots: ['.cortex', '.github/workflows', '.task'],
    excludedPaths: ['.cortex/.session'],
    runtimeBehaviorContract: '',
    validationSelectors: ['loom:cortex-audit', 'loom:verify'],
  },
  {
    name: 'system_coherence_synthesizer',
    description:
      'Legacy loom-structural-experts diagnostic aggregator producing SystemCoherenceSynthesis from verified Completed and Failed terminal observations without repository exploration.',
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    skillPath:
      '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
    requiredContextPaths: [],
    allowedEvidenceFiles: [],
    allowedEvidenceDescendantRoots: [],
    excludedPaths: [],
    runtimeBehaviorContract: SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
    validationSelectors: ['loom:verify'],
  },
] as const;

const STRUCTURAL_EXPERT_CATALOG_PATH =
  'agentic-ai/loom/src/structural-experts/catalog.ts';

const STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH =
  '.cortex/teams/ai/architecture/refactoring-experts.md';

const SYSTEM_COHERENCE_SKILL_AUTHORITY_PATH =
  '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md';

const STRUCTURAL_REFACTORING_WORKFLOW_AUTHORITY_PATH =
  '.cortex/teams/ai/workflows/structural-refactoring.md';

const STRUCTURAL_EXPERT_REGISTRY_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Overview',
      requiredMarkers: [
        '`system_coherence_synthesizer` is the `loom-structural-experts` diagnostic role.',
        'It receives typed `Completed` and `Failed` structural observations from the active harness and does not inspect the repository.',
        'A failed observation remains failed. The aggregate is diagnostic output for the delivery owner.',
        'Team Gizmos and Team Agents follow the root [Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md).',
        'This registry adds only its typed structural-observation fields.',
      ],
    },
    {
      heading: '## Registry contract',
      requiredMarkers: [
        'one stable structural role;',
        'repository evidence for readers or terminal observations for the diagnostic aggregator;',
        'Every role is read-only and nondelegating.',
        'This Cortex registry defines each stable semantic role, context, and input/result contract.',
        'Children cannot add tasks, descendants, resource claims, or workflow tiers.',
      ],
    },
    {
      heading: '## Shared boundaries',
      requiredMarkers: [
        'Structural experts diagnose and propose. They do not apply repository changes.',
        'Exactly one delivery owner controls:',
        'mutate source, documentation, lifecycle, or external state.',
        'Typed workflow state remains authoritative for continuation.',
      ],
    },
    {
      heading: '## Repository-reader evidence contract',
      requiredMarkers: [
        'Each repository-reading role reports bounded findings.',
        'Every finding identifies:',
        'The expert groups compatible findings into proposed edit groups.',
        'This is a typed task and result handoff.',
        'The parent reviews the ordinary result before assigning edits.',
      ],
    },
    {
      heading: '## `system_coherence_synthesizer`',
      requiredMarkers: [
        'This is the standalone structural/Cortex diagnostic aggregator used by `loom-structural-experts`.',
        'Its terminal-observation inputs may carry:',
        'It receives typed `Completed` and `Failed` terminal observations and bounded semantic views.',
        'It declares empty repository read claims, write claims, and evidence surface.',
        'It has no repository read scope.',
        'Its `SystemCoherenceSynthesis` output is diagnostic-only. A failed child does not become accepted evidence, and the aggregate cannot authorize implementation.',
        'The handoff remains ordinary typed data between trusted peers.',
        'The repository-reader category remains separate:',
        'It cannot schedule successors or authorize writes.',
      ],
    },
  ];

const SYSTEM_COHERENCE_SKILL_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Scope',
      requiredMarkers: [
        'The synthesizer has no repository read scope.',
        'The input boundary requires:',
        'the declared child tasks and their `Completed` or `Failed` status;',
        'The synthesizer does not inspect source, create new evidence, apply patches, authorize writes, schedule successors, or mutate lifecycle state.',
        '[Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md).',
        'This role adds only the structural observations required for synthesis.',
        '`system_coherence_synthesizer` and `SystemCoherenceSynthesis` are diagnostic identities.',
        'Failed observations never count as accepted provider evidence.',
      ],
    },
  ];

const STRUCTURAL_REFACTORING_WORKFLOW_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Freeze the evidence plan',
      requiredMarkers: [
        'Resolves one exact Git baseline.',
        'Declares each task, dependency, parent, and bounded scope.',
        'Repository-reading experts receive bounded read claims and non-empty read-covered evidence surfaces.',
        'The synthesizer receives the resulting typed child observations.',
        'Freezes every task and dependency.',
      ],
    },
    {
      heading: '## Synthesize system coherence',
      requiredMarkers: [
        'This section defines the `system_coherence_synthesizer` and its `SystemCoherenceSynthesis` diagnostic result.',
        'It accepts their typed `Completed` or `Failed` observations.',
        '[Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md).',
        "It cannot authorize implementation or replace the delivery owner's review.",
      ],
    },
  ];

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

type AuditAuthorityContractRequest = {
  readonly findings: StructuralExpertAuditFinding[];
  readonly path: string;
  readonly sections: readonly MarkdownContractSection[];
  readonly source: string;
};
