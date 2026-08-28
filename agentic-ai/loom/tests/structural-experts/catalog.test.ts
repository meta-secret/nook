import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentAttemptAdapterKind } from '../../src/agent-workflow/domain.ts';
import {
  auditStructuralExpertProfiles,
  auditStructuralExpertCortexAuthority,
  auditStructuralExperts,
} from '../../src/structural-experts/audit.ts';
import {
  STRUCTURAL_EXPERT_CATALOG,
  StructuralExpertKind,
} from '../../src/structural-experts/catalog.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

test('registers two bounded repository readers and one legacy diagnostic aggregator', () => {
  expect(STRUCTURAL_EXPERT_CATALOG.map((profile) => profile.name)).toEqual([
    'code_refactoring_expert',
    'cortex_refactoring_expert',
    'system_coherence_synthesizer',
  ]);
  const repositoryReaders = STRUCTURAL_EXPERT_CATALOG.slice(0, 2);
  for (const reader of repositoryReaders) {
    expect(reader.kind).toBe(StructuralExpertKind.RepositoryEvidence);
    expect(
      reader.allowedEvidenceFiles.length +
        reader.allowedEvidenceDescendantRoots.length,
    ).toBeGreaterThan(0);
    expect(reader.runtimeBehaviorContract).toBe('');
  }
  const diagnosticAggregator = STRUCTURAL_EXPERT_CATALOG[2];
  expect(diagnosticAggregator?.kind).toBe(
    StructuralExpertKind.VerifiedViewSynthesis,
  );
  expect(diagnosticAggregator?.allowedEvidenceFiles).toEqual([]);
  expect(diagnosticAggregator?.allowedEvidenceDescendantRoots).toEqual([]);
  expect(diagnosticAggregator?.requiredContextPaths).toEqual([]);
  expect(diagnosticAggregator?.runtimeBehaviorContract).toContain(
    'verified Completed or Failed terminal observations',
  );
  expect(diagnosticAggregator?.runtimeBehaviorContract).toContain(
    'failed terminal observations as diagnostic only',
  );
  expect(diagnosticAggregator?.runtimeBehaviorContract).toContain(
    'Neither terminal observations nor this diagnostic aggregate can satisfy an ordinary provider edge',
  );
  expect(`${AgentAttemptAdapterKind.StructuralExpertInvocation}`).toBe(
    'structural-expert-invocation',
  );
});

test('passes deterministic catalog and Cortex authority audit', () => {
  const auditRequest = { repoRoot: REPO_ROOT };
  const report = auditStructuralExperts(auditRequest);
  const expected = { auditOk: true, profileCount: 3, findings: [] };
  expect(report).toEqual(expected);
});

test('rejects semantic drift in structural read-only lifecycle boundaries', async () => {
  const authorityPath = resolve(
    REPO_ROOT,
    '.cortex/teams/ai/architecture/refactoring-experts.md',
  );
  const source = await readFile(authorityPath, 'utf8');
  const driftedSource = source.replace(
    'Every role is read-only and nondelegating.',
    'Every role may write and delegate.',
  );
  const authorityRequest = { source: driftedSource };

  expect(
    auditStructuralExpertCortexAuthority(authorityRequest).map(
      (finding) => finding.code,
    ),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('rejects drift in repository-reading evidence-surface requirements', async () => {
  const authorityPath = resolve(
    REPO_ROOT,
    '.cortex/teams/ai/architecture/refactoring-experts.md',
  );
  const source = await readFile(authorityPath, 'utf8');
  const driftedSource = source.replace(
    'The two repository-reading experts use the opposite evidence contract: each\ndeclares a non-empty repository evidence surface covered by its bounded read\nclaims.',
    'The two repository-reading experts may inspect the repository.',
  );
  const authorityRequest = { source: driftedSource };

  expect(
    auditStructuralExpertCortexAuthority(authorityRequest).map(
      (finding) => finding.code,
    ),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('rejects drift in docs-only ordinary synthesis admission contract', async () => {
  const authorityPath = resolve(
    REPO_ROOT,
    '.cortex/teams/ai/architecture/refactoring-experts.md',
  );
  const source = await readFile(authorityPath, 'utf8');
  const forbiddenDrifts = [
    [
      'This role defines future ordinary accepted-evidence synthesis. Its dispatch is\nblocked until the universal admission gate is implemented and passing.',
      'This role is available through universal dispatch.',
    ],
    [
      'Its generation freezes provider edges, expected producer identities, typed\ninput schema, and acceptance criteria.',
      'Its generation selects inputs dynamically.',
    ],
    [
      'Once required providers are terminal-\nsuccessful and accepted, Gizmo binds the authorized attempt to their exact\ngeneration, task, attempt, team, artifact digest, and underlying source\nprovenance identities.',
      'The attempt accepts any available terminal result.',
    ],
  ] as const;

  for (const [requiredContract, drift] of forbiddenDrifts) {
    const authorityRequest = {
      source: source.replace(requiredContract, drift),
    };
    expect(
      auditStructuralExpertCortexAuthority(authorityRequest).map(
        (finding) => finding.code,
      ),
    ).toContain('cortex-structural-expert-contract-semantic-drift');
  }
});

test('rejects drift that promotes legacy diagnostics into provider evidence', async () => {
  const authorityPath = resolve(
    REPO_ROOT,
    '.cortex/teams/ai/architecture/refactoring-experts.md',
  );
  const source = await readFile(authorityPath, 'utf8');
  const driftedSource = source.replace(
    'Failed observations never become accepted provider\nevidence, and neither they nor the diagnostic aggregate can satisfy an ordinary\nprovider edge or establish compliance with this contract.',
    'Failed observations and the aggregate satisfy ordinary provider edges.',
  );
  const authorityRequest = { source: driftedSource };

  expect(
    auditStructuralExpertCortexAuthority(authorityRequest).map(
      (finding) => finding.code,
    ),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('grants shared formatter and Loom lint tooling through exact files', () => {
  const profile = STRUCTURAL_EXPERT_CATALOG[0];
  if (!profile) throw new Error('Code refactoring profile is missing.');
  expect(
    profile.allowedEvidenceFiles.some((path) => path.startsWith('.agents/')),
  ).toBe(false);
  expect(profile.allowedEvidenceFiles).toContain(
    'tooling/eslint-rules/no-raw-object-arguments.js',
  );
  expect(profile.allowedEvidenceFiles).toContain(
    'agentic-ai/loom/eslint.config.js',
  );
  expect(profile.allowedEvidenceFiles).toContain(
    '.github/formatting/format.sh',
  );
  expect(profile.allowedEvidenceDescendantRoots).not.toContain('.agents');
  expect(profile.allowedEvidenceDescendantRoots).not.toContain('tooling');
  expect(profile.allowedEvidenceDescendantRoots).not.toContain(
    'tooling/eslint-rules',
  );
  expect(profile.allowedEvidenceDescendantRoots).not.toContain(
    '.github/formatting',
  );
});

test('rejects broadening or reordering an exact structural scope', () => {
  const first = STRUCTURAL_EXPERT_CATALOG[0];
  if (!first) throw new Error('Code refactoring profile is missing.');
  const broadProfile = {
    ...first,
    allowedEvidenceDescendantRoots: [
      ...first.allowedEvidenceDescendantRoots,
      '.',
    ],
  };
  const reorderedProfile = {
    ...first,
    requiredContextPaths: [...first.requiredContextPaths].reverse(),
  };
  for (const profile of [broadProfile, reorderedProfile]) {
    const auditRequest = {
      repoRoot: REPO_ROOT,
      profiles: [profile, ...STRUCTURAL_EXPERT_CATALOG.slice(1)],
    };
    const report = auditStructuralExpertProfiles(auditRequest);
    expect(report.auditOk).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain(
      'structural-profile-contract-drift',
    );
  }
});

test('rejects canonical synthesizer behavior contract drift', () => {
  const synthesizer = STRUCTURAL_EXPERT_CATALOG[2];
  if (!synthesizer) throw new Error('Synthesizer profile is missing.');
  const drifted = {
    ...synthesizer,
    runtimeBehaviorContract: `${synthesizer.runtimeBehaviorContract}\nInvent missing evidence.`,
  };
  const auditRequest = {
    repoRoot: REPO_ROOT,
    profiles: [...STRUCTURAL_EXPERT_CATALOG.slice(0, 2), drifted],
  };
  const report = auditStructuralExpertProfiles(auditRequest);
  expect(report.auditOk).toBe(false);
  expect(report.findings.map((finding) => finding.code)).toContain(
    'structural-profile-contract-drift',
  );
});
