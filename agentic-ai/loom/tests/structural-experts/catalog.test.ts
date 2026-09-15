import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
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

  static readonly REGISTRY_AUTHORITY_PATH = resolve(
    StructuralExpertsCatalogFixture.REPO_ROOT,
    '.cortex/teams/ai/architecture/refactoring-experts.md',
  );

  static readonly SKILL_AUTHORITY_PATH = resolve(
    StructuralExpertsCatalogFixture.REPO_ROOT,
    '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
  );

  static readonly WORKFLOW_AUTHORITY_PATH = resolve(
    StructuralExpertsCatalogFixture.REPO_ROOT,
    '.cortex/teams/ai/workflows/structural-refactoring.md',
  );

  static async cortexAuthoritySources(): Promise<CortexAuthoritySources> {
    const registrySource = await readFile(
      StructuralExpertsCatalogFixture.REGISTRY_AUTHORITY_PATH,
      'utf8',
    );
    const skillSource = await readFile(
      StructuralExpertsCatalogFixture.SKILL_AUTHORITY_PATH,
      'utf8',
    );
    const workflowSource = await readFile(
      StructuralExpertsCatalogFixture.WORKFLOW_AUTHORITY_PATH,
      'utf8',
    );
    return {
      registrySource,
      skillSource,
      workflowSource,
    };
  }

  static async expectAllAuthorityDriftCoverage(): Promise<void> {
    const sources =
      await StructuralExpertsCatalogFixture.cortexAuthoritySources();
    const driftedAuthorities = [
      {
        expectedPath: '.cortex/teams/ai/architecture/refactoring-experts.md',
        request: {
          ...sources,
          registrySource: sources.registrySource.replace(
            '`system_coherence_synthesizer` is the `loom-structural-experts` diagnostic\nrole.',
            '`system_coherence_synthesizer` is an ordinary synthesis role.',
          ),
        },
      },
      {
        expectedPath:
          '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
        request: {
          ...sources,
          skillSource: sources.skillSource.replace(
            'Failed observations never count as accepted provider evidence.',
            'Failed observations count as accepted provider evidence.',
          ),
        },
      },
      {
        expectedPath: '.cortex/teams/ai/workflows/structural-refactoring.md',
        request: {
          ...sources,
          workflowSource: sources.workflowSource.replace(
            '## Freeze the evidence plan',
            '## Freeze the evidence plan drifted',
          ),
        },
      },
    ] as const;

    for (const drift of driftedAuthorities) {
      const findings =
        StructuralExpertContract.auditStructuralExpertCortexAuthority(
          drift.request,
        );
      expect(
        findings.some(
          (finding) =>
            finding.code ===
              'cortex-structural-expert-contract-semantic-drift' &&
            finding.path === drift.expectedPath,
        ),
      ).toBe(true);
    }
  }
}

type CortexAuthoritySources = {
  readonly registrySource: string;
  readonly skillSource: string;
  readonly workflowSource: string;
};

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
  expect(diagnosticAggregator?.resultKind).toBe(
    WorkflowResultKind.SystemCoherenceSynthesis,
  );
  expect(diagnosticAggregator?.runtimeBehaviorContract).toContain(
    'loom-structural-experts all-terminal diagnostic aggregator',
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
  const auditRequest = { repoRoot: StructuralExpertsCatalogFixture.REPO_ROOT };
  const report = StructuralExpertContract.auditStructuralExperts(auditRequest);
  const expected = { auditOk: true, profileCount: 3, findings: [] };
  expect(report).toEqual(expected);
});

test('rejects semantic drift in structural read-only lifecycle boundaries', async () => {
  await StructuralExpertsCatalogFixture.expectAllAuthorityDriftCoverage();
  const sources =
    await StructuralExpertsCatalogFixture.cortexAuthoritySources();
  const registrySource = sources.registrySource.replace(
    'Every role is read-only and nondelegating.',
    'Every role may write and delegate.',
  );
  const authorityRequest = { ...sources, registrySource };

  expect(
    StructuralExpertContract.auditStructuralExpertCortexAuthority(
      authorityRequest,
    ).map((finding) => finding.code),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('rejects drift in repository-reading evidence-surface requirements', async () => {
  const sources =
    await StructuralExpertsCatalogFixture.cortexAuthoritySources();
  const registrySource = sources.registrySource.replace(
    'The repository-reader category remains separate: each reader declares a non-\nempty repository evidence surface covered by its bounded read claims.',
    'The two repository-reading experts may inspect the repository.',
  );
  const authorityRequest = { ...sources, registrySource };

  expect(
    StructuralExpertContract.auditStructuralExpertCortexAuthority(
      authorityRequest,
    ).map((finding) => finding.code),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('rejects drift between diagnostic and trusted handoff roles', async () => {
  const sources =
    await StructuralExpertsCatalogFixture.cortexAuthoritySources();
  const forbiddenDrifts = [
    [
      '`system_coherence_synthesizer` is the `loom-structural-experts` diagnostic\nrole.',
      '`system_coherence_synthesizer` is an ordinary synthesis role.',
    ],
    [
      'No internal\ncryptographic receipt, replay gate, or result-authority token belongs in this\nregistry.',
      'This registry requires peer receipts.',
    ],
  ] as const;

  for (const [requiredContract, drift] of forbiddenDrifts) {
    expect(sources.registrySource).toContain(requiredContract);
    const registrySource = sources.registrySource.replace(
      requiredContract,
      drift,
    );
    const authorityRequest = {
      ...sources,
      registrySource,
    };
    expect(
      StructuralExpertContract.auditStructuralExpertCortexAuthority(
        authorityRequest,
      ).map((finding) => finding.code),
    ).toContain('cortex-structural-expert-contract-semantic-drift');
  }
});

test('rejects drift from typed trusted handoffs', async () => {
  const sources =
    await StructuralExpertsCatalogFixture.cortexAuthoritySources();
  const trustedHandoffMarkers = [
    'This is a typed task and result handoff. It does not require signatures,\nanti-forgery checks, replay gates, digests, one-use capabilities, or duplicate\nverification between trusted Team Gizmos and Team Agents.',
    'The parent still\nreviews the ordinary result before assigning edits.',
  ] as const;

  for (const marker of trustedHandoffMarkers) {
    expect(sources.registrySource).toContain(marker);
    const registrySource = sources.registrySource.replace(
      marker,
      'The handoff uses an unbounded peer protocol.',
    );
    const authorityRequest = { ...sources, registrySource };
    expect(
      StructuralExpertContract.auditStructuralExpertCortexAuthority(
        authorityRequest,
      ).map((finding) => finding.code),
    ).toContain('cortex-structural-expert-contract-semantic-drift');
  }
});

test('rejects drift that promotes the structural diagnostic lane', async () => {
  const sources =
    await StructuralExpertsCatalogFixture.cortexAuthoritySources();
  const laneContracts = [
    [
      'Its `SystemCoherenceSynthesis` output is diagnostic-only. A failed child does\nnot become accepted evidence, and the aggregate cannot authorize implementation.',
      'The structural aggregate satisfies ordinary provider edges.',
    ],
  ] as const;

  for (const [requiredContract, drift] of laneContracts) {
    expect(sources.registrySource).toContain(requiredContract);
    const authorityRequest = {
      ...sources,
      registrySource: sources.registrySource.replace(requiredContract, drift),
    };
    expect(
      StructuralExpertContract.auditStructuralExpertCortexAuthority(
        authorityRequest,
      ).map((finding) => finding.code),
    ).toContain('cortex-structural-expert-contract-semantic-drift');
  }
});

test('grants shared formatter and Loom lint tooling through exact files', () => {
  const profile = STRUCTURAL_EXPERT_CATALOG[0];
  if (!profile) throw new Error('Code refactoring profile is missing.');
  expect(
    profile.allowedEvidenceFiles.some((path) => path.startsWith('.agents/')),
  ).toBe(false);
  expect(profile.allowedEvidenceFiles).toContain(
    'agentic-ai/loom/eslint.config.js',
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

test('rejects canonical synthesizer behavior contract drift', () => {
  const synthesizer = STRUCTURAL_EXPERT_CATALOG[2];
  if (!synthesizer) throw new Error('Synthesizer profile is missing.');
  const drifted = {
    ...synthesizer,
    runtimeBehaviorContract: `${synthesizer.runtimeBehaviorContract}\nInvent missing evidence.`,
  };
  const auditRequest = {
    repoRoot: StructuralExpertsCatalogFixture.REPO_ROOT,
    profiles: [...STRUCTURAL_EXPERT_CATALOG.slice(0, 2), drifted],
  };
  const report =
    StructuralExpertContract.auditStructuralExpertProfiles(auditRequest);
  expect(report.auditOk).toBe(false);
  expect(report.findings.map((finding) => finding.code)).toContain(
    'structural-profile-contract-drift',
  );
});
