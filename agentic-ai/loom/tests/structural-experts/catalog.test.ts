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

test('grants shared formatter and skill lint tooling through exact files', () => {
  const profile = STRUCTURAL_EXPERT_CATALOG[0];
  if (!profile) throw new Error('Code refactoring profile is missing.');
  expect(
    profile.allowedEvidenceFiles.filter((path) =>
      path.startsWith('.agents/skills/'),
    ),
  ).toEqual([
    '.agents/skills/eslint.config.js',
    '.agents/skills/package.json',
    '.agents/skills/tsconfig.json',
    '.agents/skills/bun.lock',
    '.agents/skills/.prettierrc',
    '.agents/skills/typescript-named-args/tests/eslint-contract.test.ts',
  ]);
  expect(profile.allowedEvidenceFiles).toContain(
    'tooling/eslint-rules/no-raw-object-arguments.js',
  );
  expect(profile.allowedEvidenceFiles).toContain(
    'agentic-ai/loom/eslint.config.js',
  );
  expect(profile.allowedEvidenceFiles).toContain(
    '.github/formatting/format.sh',
  );
  expect(profile.allowedEvidenceDescendantRoots).not.toContain(
    '.agents/skills',
  );
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
