import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { WorkflowResultKind } from '../agent-workflow/domain.ts';
import {
  STRUCTURAL_EXPERT_CATALOG,
  StructuralExpertKind,
  SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
} from './catalog.ts';
import type { StructuralExpertProfile } from './catalog.ts';
import { auditMarkdownContractSections } from '../lib/markdown-contract.ts';
import type {
  MarkdownContractAuditRequest,
  MarkdownContractSection,
} from '../lib/markdown-contract.ts';

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
  readonly source: string;
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
      '.cortex/gizmo/workflows/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'Taskfile.yml',
      '.github/formatting/format.sh',
      'tooling/eslint-rules/no-raw-object-arguments.js',
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
      '.cortex/gizmo/workflows/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'README.md',
      'Taskfile.yml',
      'agentic-ai/loom/src/agent-workflow/cortex-workflow.ts',
      'agentic-ai/loom/src/codec/args/cortex-audit.ts',
      'agentic-ai/loom/src/commands/cortex-audit.ts',
      'agentic-ai/loom/src/lib/cortex-article-structure.ts',
      'agentic-ai/loom/src/lib/cortex-document-structure.ts',
      'agentic-ai/loom/src/lib/cortex-index.ts',
      'agentic-ai/loom/tests/agent-workflow/cortex-workflow.test.ts',
      'agentic-ai/loom/tests/cortex-article-structure.test.ts',
      'agentic-ai/loom/tests/cortex-audit-session.test.ts',
      'agentic-ai/loom/tests/cortex-document-structure.test.ts',
      'agentic-ai/loom/tests/cortex-index.test.ts',
    ],
    allowedEvidenceDescendantRoots: ['.cortex', '.github/workflows', '.task'],
    excludedPaths: ['.cortex/.session'],
    runtimeBehaviorContract: '',
    validationSelectors: ['loom:cortex-audit', 'loom:verify'],
  },
  {
    name: 'system_coherence_synthesizer',
    description:
      'Read-only synthesizer that reconciles only replay-verified child results and views without repository exploration.',
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
const STRUCTURAL_EXPERT_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Registry contract',
      requiredMarkers: [
        'one stable structural role and attempt identity;',
        'one bounded read scope;',
        'Every role is read-only and nondelegating.',
        'This Cortex registry defines each stable semantic role, capability, context, and evidence contract.',
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
      heading: '## `system_coherence_synthesizer`',
      requiredMarkers: [
        'It receives only typed results, verified artifact references, and bounded semantic views.',
        'It has no repository read scope.',
        'It cannot schedule successors or authorize writes.',
      ],
    },
  ];

export function auditStructuralExperts(
  request: AuditStructuralExpertsRequest,
): StructuralExpertAuditReport {
  const profileRequest: AuditStructuralExpertProfilesRequest = {
    ...request,
    profiles: STRUCTURAL_EXPERT_CATALOG,
  };
  return auditStructuralExpertProfiles(profileRequest);
}

export function auditStructuralExpertProfiles(
  request: AuditStructuralExpertProfilesRequest,
): StructuralExpertAuditReport {
  const findings: StructuralExpertAuditFinding[] = [];
  const authorityPath = join(
    request.repoRoot,
    STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
  );
  const authoritySource = existsSync(authorityPath)
    ? readFileSync(authorityPath, 'utf8')
    : '';
  const authorityRequest: AuditStructuralExpertCortexAuthorityRequest = {
    source: authoritySource,
  };
  findings.push(...auditStructuralExpertCortexAuthority(authorityRequest));
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
    if (!profileMatchesExpectation(expectationRequest)) {
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
    validateProfile(validationRequest);
  }
  return {
    auditOk: findings.length === 0,
    profileCount: request.profiles.length,
    findings,
  };
}

type StructuralExpertExpectation = (typeof EXPECTED_PROFILES)[number];

type ProfileExpectationMatchRequest = {
  readonly expected: StructuralExpertExpectation;
  readonly profile: StructuralExpertProfile;
};

function profileMatchesExpectation(
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
    equalStrings(contextPaths) &&
    equalStrings(evidenceFiles) &&
    equalStrings(evidenceDescendantRoots) &&
    equalStrings(excludedPaths) &&
    equalStrings(validationSelectors)
  );
}

type EqualStringsRequest = {
  readonly left: readonly string[];
  readonly right: readonly string[];
};

function equalStrings(request: EqualStringsRequest): boolean {
  return JSON.stringify(request.left) === JSON.stringify(request.right);
}

type ValidateStructuralProfileRequest = {
  readonly findings: StructuralExpertAuditFinding[];
  readonly profile: StructuralExpertProfile;
  readonly repoRoot: string;
};

function validateProfile(request: ValidateStructuralProfileRequest): void {
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
    if (!safeRepositoryPath(path)) {
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
      message: 'Every structural expert requires focused validation selectors.',
    };
    findings.push(finding);
  }
  validateRoleIsolation(request);
}

export function auditStructuralExpertCortexAuthority(
  request: AuditStructuralExpertCortexAuthorityRequest,
): readonly StructuralExpertAuditFinding[] {
  const findings: StructuralExpertAuditFinding[] = [];
  const contractAuditRequest: MarkdownContractAuditRequest = {
    sections: STRUCTURAL_EXPERT_CONTRACT_SECTIONS,
    source: request.source,
  };
  for (const drift of auditMarkdownContractSections(contractAuditRequest)) {
    const finding: StructuralExpertAuditFinding = {
      code: 'cortex-structural-expert-contract-semantic-drift',
      path: STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
      message: `Canonical Cortex structural expert contract drifted in ${drift.heading}: ${drift.missingMarkers.join(', ')}`,
    };
    findings.push(finding);
  }
  for (const profile of STRUCTURAL_EXPERT_CATALOG) {
    const marker = `## \`${profile.name}\``;
    if (request.source.includes(marker)) continue;
    const finding: StructuralExpertAuditFinding = {
      code: 'missing-cortex-structural-expert-role',
      path: STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
      message: `Canonical Cortex structural expert role is missing: ${profile.name}`,
    };
    findings.push(finding);
  }
  return findings;
}

function validateRoleIsolation(
  request: ValidateStructuralProfileRequest,
): void {
  const profile = request.profile;
  const synthesis = profile.kind === StructuralExpertKind.VerifiedViewSynthesis;
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
        'Evidence experts require bounded repository roots; synthesis must receive verified child views only.',
    };
    request.findings.push(finding);
  }
}

export function safeRepositoryPath(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\u0000') &&
    !path.split('/').includes('..') &&
    normalize(path) === path
  );
}
