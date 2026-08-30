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
  readonly delegationSource: string;
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
      'agentic-ai/loom/src/codec/args/cortex-audit.ts',
      'agentic-ai/loom/src/commands/cortex-audit.ts',
      'agentic-ai/loom/src/lib/cortex-article-structure.ts',
      'agentic-ai/loom/src/lib/cortex-document-structure.ts',
      'agentic-ai/loom/src/lib/cortex-index.ts',
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
const SUBAGENT_DELEGATION_AUTHORITY_PATH =
  '.cortex/gizmo/workflows/subagent-delegation.md';
const SYSTEM_COHERENCE_SKILL_AUTHORITY_PATH =
  '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md';
const STRUCTURAL_REFACTORING_WORKFLOW_AUTHORITY_PATH =
  '.cortex/teams/ai/workflows/structural-refactoring.md';
const STRUCTURAL_EXPERT_REGISTRY_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Overview',
      requiredMarkers: [
        '`system_coherence_synthesizer` is that legacy `loom-structural-experts` role.',
        'It receives verified typed `Completed` and `Failed` structural terminal observations and does not inspect the repository.',
        'Failed observations are not accepted provider evidence, and its output cannot satisfy an ordinary provider edge or claim ordinary-contract compliance.',
        'Future ordinary accepted-evidence synthesis must use a distinct typed role, profile, and result contract before implementation.',
        'None is named or registered here, and ordinary dispatch remains fail-closed.',
      ],
    },
    {
      heading: '## Registry contract',
      requiredMarkers: [
        'one stable structural role and attempt identity;',
        'one of three disjoint input categories: repository evidence for readers, terminal-observation inputs for the legacy structural aggregator, or accepted provider-evidence inputs for a future unnamed ordinary role;',
        'Every role is read-only and nondelegating.',
        'This Cortex registry defines each stable semantic role, capability, context, and input/result contract.',
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
        'Every authorization binds task, expert, attempt, depth two, and immediate parent. Its evidence alternative is exactly one of:',
        'a repository-reading expert binds the exact source commit, bounded read claims, non-empty evidence surface, and exact evidence paths;',
        'the legacy `system_coherence_synthesizer` binds the exact `loom-structural-experts` parent-authorized structural all-terminal observation barrier, including each verified `StructuralExpertPlan` child task, expert, attempt, `Completed` or `Failed` status, result/view identity, digest, and inherited source provenance;',
        'a future unnamed ordinary accepted-evidence role would bind generation-frozen provider edges, expected producer identities, typed input schema, and acceptance criteria, then exact accepted artifacts, digests, and provenance when Gizmo authorizes its ready attempt.',
        'The third alternative is documentary only: no role/profile/result identity or runtime support exists, and ordinary dispatch remains fail-closed.',
      ],
    },
    {
      heading: '## `system_coherence_synthesizer`',
      requiredMarkers: [
        'This is the legacy standalone structural/Cortex diagnostic aggregator used by `loom-structural-experts`.',
        'It receives verified typed `Completed` and `Failed` terminal observations, artifact references, and bounded semantic views.',
        'It declares empty repository read claims, write claims, and evidence surface.',
        'It has no repository read scope.',
        'preserves disagreements and failed terminal observations without treating failures as accepted provider evidence;',
        'Its `SystemCoherenceSynthesis` output is diagnostic-only. Neither an input failure nor the aggregate can satisfy an ordinary provider edge, authorize implementation, or establish compliance with ordinary accepted-evidence synthesis.',
        'Future ordinary synthesis requires a distinct typed role/profile/result contract that freezes provider edges, expected producer identities, input schema, and acceptance criteria before Gizmo later binds exact accepted inputs at attempt authorization.',
        'This registry does not name or implement that future contract. Universal ordinary dispatch remains fail-closed.',
        'The repository-reader category remains separate:',
        'repository evidence surface covered by its bounded read claims.',
        'It cannot schedule successors or authorize writes.',
      ],
    },
  ];
const SUBAGENT_DELEGATION_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Safe delegation patterns',
      requiredMarkers: [
        '`system_coherence_synthesizer` and `SystemCoherenceSynthesis` remain legacy `loom-structural-experts` diagnostic identities.',
        'They accept verified structural `Completed` and `Failed` observations, cannot satisfy ordinary provider edges, and must not be reused for future ordinary accepted-evidence synthesis.',
        'Future ordinary synthesis requires a distinct typed role, profile, and result contract before implementation; no such identity or runtime support is declared here, so ordinary dispatch remains fail-closed.',
      ],
    },
  ];
const SYSTEM_COHERENCE_SKILL_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Scope',
      requiredMarkers: [
        "the `loom-structural-experts` parent-authorized all-terminal observation barrier's verified `StructuralExpertPlan` child projections with `Completed` or `Failed` status;",
        '`system_coherence_synthesizer` and `SystemCoherenceSynthesis` are legacy diagnostic identities.',
        'Failed observations never count as accepted provider evidence, and the legacy output cannot satisfy an ordinary provider edge, authorize implementation, or claim ordinary-contract compliance.',
        'Future ordinary accepted-evidence synthesis requires a distinct typed role, profile, and result contract before implementation.',
        'This card does not name or provide that contract. Universal ordinary dispatch remains fail-closed.',
      ],
    },
  ];
const STRUCTURAL_REFACTORING_WORKFLOW_CONTRACT_SECTIONS: readonly MarkdownContractSection[] =
  [
    {
      heading: '## Freeze the evidence plan',
      requiredMarkers: [
        'the legacy synthesizer receives empty repository claims and evidence surface',
        'plus verified typed `StructuralExpertPlan` child projections from its parent-',
        'authorized all-terminal observation barrier.',
        "Declares the legacy diagnostic run's all-terminal observation barrier.",
      ],
    },
    {
      heading: '## Synthesize system coherence',
      requiredMarkers: [
        'This section defines the legacy `loom-structural-experts` `system_coherence_synthesizer` and its `SystemCoherenceSynthesis` diagnostic result.',
        'The role waits for the `loom-structural-experts` parent-authorized structural all-terminal observation barrier and accepts the verified `StructuralExpertPlan` child projections with `Completed` or `Failed` status.',
        'Preserves disagreements and failed observations without calling failures accepted provider evidence.',
        '`SystemCoherenceSynthesis` is diagnostic-only. It cannot satisfy an ordinary provider edge, authorize implementation, or claim ordinary accepted-evidence synthesis compliance.',
      ],
    },
    {
      heading: '## Future ordinary synthesis boundary',
      requiredMarkers: [
        'Future ordinary accepted-evidence synthesis must use a distinct typed role, profile, and result contract before implementation.',
        'Its generation will freeze provider edges, expected producer identities, typed input schema, and acceptance criteria; Gizmo will bind exact accepted inputs only when authorizing a ready attempt.',
        'Universal ordinary dispatch remains fail-closed until runtime enforcement exists.',
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
  const registrySource = existsSync(authorityPath)
    ? readFileSync(authorityPath, 'utf8')
    : '';
  const delegationPath = join(
    request.repoRoot,
    SUBAGENT_DELEGATION_AUTHORITY_PATH,
  );
  const delegationSource = existsSync(delegationPath)
    ? readFileSync(delegationPath, 'utf8')
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
    delegationSource,
    registrySource,
    skillSource,
    workflowSource,
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
  const registryAuditRequest: AuditAuthorityContractRequest = {
    findings,
    path: STRUCTURAL_EXPERT_CORTEX_AUTHORITY_PATH,
    sections: STRUCTURAL_EXPERT_REGISTRY_CONTRACT_SECTIONS,
    source: request.registrySource,
  };
  auditAuthorityContract(registryAuditRequest);
  const delegationAuditRequest: AuditAuthorityContractRequest = {
    findings,
    path: SUBAGENT_DELEGATION_AUTHORITY_PATH,
    sections: SUBAGENT_DELEGATION_CONTRACT_SECTIONS,
    source: request.delegationSource,
  };
  auditAuthorityContract(delegationAuditRequest);
  const skillAuditRequest: AuditAuthorityContractRequest = {
    findings,
    path: SYSTEM_COHERENCE_SKILL_AUTHORITY_PATH,
    sections: SYSTEM_COHERENCE_SKILL_CONTRACT_SECTIONS,
    source: request.skillSource,
  };
  auditAuthorityContract(skillAuditRequest);
  const workflowAuditRequest: AuditAuthorityContractRequest = {
    findings,
    path: STRUCTURAL_REFACTORING_WORKFLOW_AUTHORITY_PATH,
    sections: STRUCTURAL_REFACTORING_WORKFLOW_CONTRACT_SECTIONS,
    source: request.workflowSource,
  };
  auditAuthorityContract(workflowAuditRequest);
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

type AuditAuthorityContractRequest = {
  readonly findings: StructuralExpertAuditFinding[];
  readonly path: string;
  readonly sections: readonly MarkdownContractSection[];
  readonly source: string;
};

function auditAuthorityContract(request: AuditAuthorityContractRequest): void {
  const contractAuditRequest: MarkdownContractAuditRequest = {
    sections: request.sections,
    source: request.source,
  };
  for (const drift of auditMarkdownContractSections(contractAuditRequest)) {
    const finding: StructuralExpertAuditFinding = {
      code: 'cortex-structural-expert-contract-semantic-drift',
      path: request.path,
      message: `Canonical Cortex structural expert contract drifted in ${drift.heading}: ${drift.missingMarkers.join(', ')}`,
    };
    request.findings.push(finding);
  }
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
        'Repository evidence experts require bounded repository scope; legacy diagnostic aggregation must remain repository-blind and use verified terminal observations only.',
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
