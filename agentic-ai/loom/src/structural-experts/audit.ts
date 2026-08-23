import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { WorkflowResultKind } from '../agent-workflow/domain.ts';
import {
  STRUCTURAL_EXPERT_CATALOG,
  StructuralExpertKind,
  SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
} from './catalog.ts';
import type { StructuralExpertProfile } from './catalog.ts';

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
    agentDefinitionPath:
      '.codex/agents/structural-experts/code_refactoring_expert.toml',
    skillPath: '.agents/skills/code-refactoring-expert/SKILL.md',
    requiredContextPaths: [
      '.cortex/AGENTS.md',
      '.cortex/knowledge-graph.md',
      '.cortex/architecture/refactoring-experts.md',
      '.cortex/workflows/structural-refactoring.md',
      '.cortex/workflows/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'Taskfile.yml',
      'agentic-ai/loom/package.json',
      '.agents/skills/package.json',
      '.agents/skills/bun.lock',
      '.agents/skills/cortex-article-structure/executable-skill.json',
      '.agents/skills/cortex-article-structure/src/audit.ts',
      '.agents/skills/cortex-article-structure/src/codec.ts',
      '.agents/skills/cortex-article-structure/src/domain.ts',
      '.agents/skills/cortex-article-structure/src/runner.ts',
      '.agents/skills/cortex-article-structure/src/verification.ts',
      '.agents/skills/cortex-article-structure/tests/audit.test.ts',
      '.agents/skills/cortex-article-structure/tests/codec.test.ts',
      '.agents/skills/cortex-article-structure/tests/definition.test.ts',
      '.agents/skills/cortex-article-structure/tests/markdown-fixture.ts',
      '.agents/skills/cortex-article-structure/tests/verification.test.ts',
      '.agents/skills/cortex-article-structure/tests/fixtures/containment-manifest.json',
      '.agents/skills/cortex-article-structure/tests/fixtures/containment-runner.ts',
      '.agents/skills/cortex-article-structure/tests/fixtures/overflow-manifest.json',
      '.agents/skills/cortex-article-structure/tests/fixtures/overflow-runner.ts',
      '.agents/skills/cortex-article-structure/tests/fixtures/timeout-manifest.json',
      '.agents/skills/cortex-article-structure/tests/fixtures/timeout-runner.ts',
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
    resultKind: WorkflowResultKind.CortexRefactoringEvidence,
    kind: StructuralExpertKind.RepositoryEvidence,
    agentDefinitionPath:
      '.codex/agents/structural-experts/cortex_refactoring_expert.toml',
    skillPath: '.agents/skills/cortex-refactoring-expert/SKILL.md',
    requiredContextPaths: [
      '.cortex/AGENTS.md',
      '.cortex/knowledge-graph.md',
      '.cortex/architecture/refactoring-experts.md',
      '.cortex/workflows/structural-refactoring.md',
      '.cortex/workflows/subagent-delegation.md',
    ],
    allowedEvidenceFiles: [
      'README.md',
      'Taskfile.yml',
      'agentic-ai/loom/src/agent-workflow/cortex-workflow.ts',
      'agentic-ai/loom/src/codec/args/cortex-audit.ts',
      'agentic-ai/loom/src/commands/cortex-audit.ts',
      '.agents/skills/cortex-article-structure/executable-skill.json',
      '.agents/skills/cortex-article-structure/src/audit.ts',
      '.agents/skills/cortex-article-structure/src/codec.ts',
      '.agents/skills/cortex-article-structure/src/runner.ts',
      '.agents/skills/cortex-article-structure/src/domain.ts',
      '.agents/skills/cortex-article-structure/src/verification.ts',
      'agentic-ai/loom/src/lib/cortex-document-structure.ts',
      'agentic-ai/loom/src/lib/cortex-index.ts',
      'agentic-ai/loom/tests/agent-workflow/cortex-workflow.test.ts',
      '.agents/skills/cortex-article-structure/tests/audit.test.ts',
      '.agents/skills/cortex-article-structure/tests/verification.test.ts',
      'agentic-ai/loom/tests/cortex-audit-session.test.ts',
      'agentic-ai/loom/tests/cortex-document-structure.test.ts',
      'agentic-ai/loom/tests/cortex-index.test.ts',
    ],
    allowedEvidenceDescendantRoots: [
      '.agents/skills',
      '.cortex',
      '.github/workflows',
      '.task',
    ],
    excludedPaths: ['.cortex/.session'],
    runtimeBehaviorContract: '',
    validationSelectors: ['loom:cortex-audit', 'loom:verify'],
  },
  {
    name: 'system_coherence_synthesizer',
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    agentDefinitionPath:
      '.codex/agents/structural-experts/system_coherence_synthesizer.toml',
    skillPath: '.agents/skills/system-coherence-synthesizer/SKILL.md',
    requiredContextPaths: [],
    allowedEvidenceFiles: [],
    allowedEvidenceDescendantRoots: [],
    excludedPaths: [],
    runtimeBehaviorContract: SYSTEM_COHERENCE_BEHAVIOR_CONTRACT,
    validationSelectors: ['loom:verify'],
  },
] as const;

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
        path: profile.agentDefinitionPath,
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
    profile.resultKind === expected.resultKind &&
    profile.kind === expected.kind &&
    profile.agentDefinitionPath === expected.agentDefinitionPath &&
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
  const expectedDefinition = `.codex/agents/structural-experts/${profile.name}.toml`;
  const expectedSkills = new Map([
    [
      'code_refactoring_expert',
      '.agents/skills/code-refactoring-expert/SKILL.md',
    ],
    [
      'cortex_refactoring_expert',
      '.agents/skills/cortex-refactoring-expert/SKILL.md',
    ],
    [
      'system_coherence_synthesizer',
      '.agents/skills/system-coherence-synthesizer/SKILL.md',
    ],
  ]);
  const expectedSkill = expectedSkills.get(profile.name);
  if (
    profile.agentDefinitionPath !== expectedDefinition ||
    !expectedSkill ||
    profile.skillPath !== expectedSkill
  ) {
    const finding: StructuralExpertAuditFinding = {
      code: 'noncanonical-structural-profile-path',
      path: profile.agentDefinitionPath,
      message:
        'Structural expert definitions and skills require canonical paths.',
    };
    findings.push(finding);
  }
  const paths = [
    profile.agentDefinitionPath,
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
    profile.agentDefinitionPath,
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
      path: profile.agentDefinitionPath,
      message: 'Every structural expert requires focused validation selectors.',
    };
    findings.push(finding);
  }
  validateRoleIsolation(request);
  validateAgentDefinition(request);
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
      path: profile.agentDefinitionPath,
      message:
        'Evidence experts require bounded repository roots; synthesis must receive verified child views only.',
    };
    request.findings.push(finding);
  }
}

function validateAgentDefinition(
  request: ValidateStructuralProfileRequest,
): void {
  const path = join(request.repoRoot, request.profile.agentDefinitionPath);
  if (!existsSync(path)) return;
  const source = readFileSync(path, 'utf8');
  const required = [
    `name = "${request.profile.name}"`,
    'sandbox_mode = "read-only"',
    'approval_policy = "never"',
  ];
  if (required.some((marker) => !source.includes(marker))) {
    const finding: StructuralExpertAuditFinding = {
      code: 'unsafe-structural-agent-definition',
      path: request.profile.agentDefinitionPath,
      message: 'Structural expert TOML must retain exact read-only identity.',
    };
    request.findings.push(finding);
  }
  if (
    request.profile.kind === StructuralExpertKind.VerifiedViewSynthesis &&
    extractedDeveloperInstructions(source) !==
      request.profile.runtimeBehaviorContract
  ) {
    const finding: StructuralExpertAuditFinding = {
      code: 'structural-runtime-behavior-contract-drift',
      path: request.profile.agentDefinitionPath,
      message:
        'The synthesizer runtime behavior contract must exactly match its reviewed TOML definition.',
    };
    request.findings.push(finding);
  }
}

function extractedDeveloperInstructions(source: string): string | false {
  const match = source.match(/developer_instructions = """\n([\s\S]*?)\n"""/u);
  if (!match) return false;
  const instructions = match[1];
  return typeof instructions === 'string' ? instructions : false;
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
