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
