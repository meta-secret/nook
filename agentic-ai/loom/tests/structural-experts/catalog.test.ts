import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { AgentAttemptAdapterKind } from '../../src/agent-workflow/domain.ts';
import {
  auditStructuralExpertProfiles,
  auditStructuralExperts,
} from '../../src/structural-experts/audit.ts';
import {
  STRUCTURAL_EXPERT_CATALOG,
  StructuralExpertKind,
} from '../../src/structural-experts/catalog.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

test('registers exactly two bounded readers and one view-only synthesizer', () => {
  expect(STRUCTURAL_EXPERT_CATALOG.map((profile) => profile.name)).toEqual([
    'code_refactoring_expert',
    'cortex_refactoring_expert',
    'system_coherence_synthesizer',
  ]);
  const synthesizer = STRUCTURAL_EXPERT_CATALOG[2];
  expect(synthesizer?.kind).toBe(StructuralExpertKind.VerifiedViewSynthesis);
  expect(synthesizer?.allowedEvidenceFiles).toEqual([]);
  expect(synthesizer?.allowedEvidenceDescendantRoots).toEqual([]);
  expect(synthesizer?.requiredContextPaths).toEqual([]);
  expect(synthesizer?.runtimeBehaviorContract).toContain(
    'Use only the typed results',
  );
  expect(`${AgentAttemptAdapterKind.StructuralExpertInvocation}`).toBe(
    'structural-expert-invocation',
  );
});

test('passes deterministic catalog and definition audit', () => {
  const auditRequest = { repoRoot: REPO_ROOT };
  const report = auditStructuralExperts(auditRequest);
  const expected = { auditOk: true, profileCount: 3, findings: [] };
  expect(report).toEqual(expected);
});

test('grants executable-skill code through exact files without a broad skill root', () => {
  const profile = STRUCTURAL_EXPERT_CATALOG[0];
  if (!profile) throw new Error('Code refactoring profile is missing.');
  expect(
    profile.allowedEvidenceFiles.filter((path) =>
      path.startsWith('.agents/skills/'),
    ),
  ).toEqual([
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
  ]);
  expect(profile.allowedEvidenceDescendantRoots).not.toContain(
    '.agents/skills',
  );
  expect(profile.allowedEvidenceDescendantRoots).not.toContain(
    '.agents/skills/cortex-article-structure',
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

test('rejects synthesizer runtime behavior contract drift', () => {
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
  expect(report.findings.map((finding) => finding.code)).toContain(
    'structural-runtime-behavior-contract-drift',
  );
});
