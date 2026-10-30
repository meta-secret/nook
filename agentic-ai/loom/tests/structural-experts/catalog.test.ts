import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  AgentAttemptAdapterKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import { StructuralExpertContract } from '../../src/structural-experts/audit.ts';
import {
  STRUCTURAL_EXPERT_CATALOG,
  StructuralExpertKind,
} from '../../src/structural-experts/catalog.ts';

/** Owns the structural experts catalog fixture and its typed role contracts. */
export class StructuralExpertsCatalogFixture {
  private constructor() {}
  static readonly REPO_ROOT = resolve(import.meta.dir, '../../../..');
}

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
  expect(diagnosticAggregator?.runtimeBehaviorContract.length).toBeGreaterThan(
    0,
  );
  expect(diagnosticAggregator?.resultKind).toBe(
    WorkflowResultKind.SystemCoherenceSynthesis,
  );
  expect(`${AgentAttemptAdapterKind.StructuralExpertInvocation}`).toBe(
    'structural-expert-invocation',
  );
});

test('passes deterministic catalog and Cortex authority audit', () => {
  const auditRequest = { repoRoot: StructuralExpertsCatalogFixture.REPO_ROOT };
  const report = StructuralExpertContract.auditStructuralExperts(auditRequest);
  const expected = { auditOk: true, profileCount: 3, findings: [] };
  expect(report).toEqual(expected);
});

test('grants shared formatter and Loom lint tooling through exact files', () => {
  const profile = STRUCTURAL_EXPERT_CATALOG[0];
  if (!profile) throw new Error('Code refactoring profile is missing.');
  expect(
    profile.allowedEvidenceFiles.some((path) => path.startsWith('.agents/')),
  ).toBe(false);
  expect(profile.allowedEvidenceFiles).toContain(
    'agentic-ai/loom/.oxlintrc.json',
  );
  expect(profile.allowedEvidenceFiles).toContain(
    '.github/formatting/format.sh',
  );
  expect(profile.allowedEvidenceDescendantRoots).not.toContain('.agents');
  expect(profile.allowedEvidenceDescendantRoots).not.toContain('tooling');
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
      repoRoot: StructuralExpertsCatalogFixture.REPO_ROOT,
      profiles: [profile, ...STRUCTURAL_EXPERT_CATALOG.slice(1)],
    };
    const report =
      StructuralExpertContract.auditStructuralExpertProfiles(auditRequest);
    expect(report.auditOk).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain(
      'structural-profile-contract-drift',
    );
  }
});

test('requires a behavior description for the diagnostic aggregator', () => {
  const synthesizer = STRUCTURAL_EXPERT_CATALOG[2];
  if (!synthesizer) throw new Error('Synthesizer profile is missing.');
  const drifted = {
    ...synthesizer,
    runtimeBehaviorContract: '',
  };
  const auditRequest = {
    repoRoot: StructuralExpertsCatalogFixture.REPO_ROOT,
    profiles: [...STRUCTURAL_EXPERT_CATALOG.slice(0, 2), drifted],
  };
  const report =
    StructuralExpertContract.auditStructuralExpertProfiles(auditRequest);
  expect(report.auditOk).toBe(false);
  expect(report.findings.map((finding) => finding.code)).toContain(
    'invalid-structural-role-isolation',
  );
});

test('accepts description edits and reordered evidence sets without expanding scope', () => {
  const profiles = STRUCTURAL_EXPERT_CATALOG.map((profile) => ({
    ...profile,
    description: 'Revised description.',
    allowedEvidenceFiles: [...profile.allowedEvidenceFiles].reverse(),
    allowedEvidenceDescendantRoots: [
      ...profile.allowedEvidenceDescendantRoots,
    ].reverse(),
    excludedPaths: [...profile.excludedPaths].reverse(),
    validationSelectors: [...profile.validationSelectors].reverse(),
  }));
  expect(
    StructuralExpertContract.auditStructuralExpertProfiles({
      repoRoot: StructuralExpertsCatalogFixture.REPO_ROOT,
      profiles,
    }),
  ).toEqual({ auditOk: true, profileCount: 3, findings: [] });
});
