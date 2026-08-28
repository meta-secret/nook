import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AgentAttemptAdapterKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import { CortexAuditAgent } from '../../src/agent-workflow/cortex-workflow.ts';
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
const REGISTRY_AUTHORITY_PATH = resolve(
  REPO_ROOT,
  '.cortex/teams/ai/architecture/refactoring-experts.md',
);
const ORCHESTRATION_AUTHORITY_PATH = resolve(
  REPO_ROOT,
  '.cortex/teams/ai/design-docs/agent-workflow-orchestration.md',
);
const DELEGATION_AUTHORITY_PATH = resolve(
  REPO_ROOT,
  '.cortex/gizmo/workflows/subagent-delegation.md',
);
const SKILL_AUTHORITY_PATH = resolve(
  REPO_ROOT,
  '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
);
const TOOLS_AUTHORITY_PATH = resolve(
  REPO_ROOT,
  '.cortex/teams/ai/references/loom-tools.md',
);
const WORKFLOW_AUTHORITY_PATH = resolve(
  REPO_ROOT,
  '.cortex/teams/ai/workflows/structural-refactoring.md',
);

type CortexAuthoritySources = {
  readonly delegationSource: string;
  readonly orchestrationSource: string;
  readonly registrySource: string;
  readonly skillSource: string;
  readonly toolsSource: string;
  readonly workflowSource: string;
};

async function cortexAuthoritySources(): Promise<CortexAuthoritySources> {
  const registrySource = await readFile(REGISTRY_AUTHORITY_PATH, 'utf8');
  const orchestrationSource = await readFile(
    ORCHESTRATION_AUTHORITY_PATH,
    'utf8',
  );
  const delegationSource = await readFile(DELEGATION_AUTHORITY_PATH, 'utf8');
  const skillSource = await readFile(SKILL_AUTHORITY_PATH, 'utf8');
  const toolsSource = await readFile(TOOLS_AUTHORITY_PATH, 'utf8');
  const workflowSource = await readFile(WORKFLOW_AUTHORITY_PATH, 'utf8');
  return {
    delegationSource,
    orchestrationSource,
    registrySource,
    skillSource,
    toolsSource,
    workflowSource,
  };
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
  expect(`${CortexAuditAgent.FindingSynthesizer}`).toBe('finding-synthesizer');
  expect(`${WorkflowResultKind.CortexSynthesis}`).toBe('cortex-synthesis');
  expect(CortexAuditAgent.FindingSynthesizer).not.toBe(
    diagnosticAggregator?.name,
  );
  expect(WorkflowResultKind.CortexSynthesis).not.toBe(
    diagnosticAggregator?.resultKind,
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

async function expectAllAuthorityDriftCoverage(): Promise<void> {
  const sources = await cortexAuthoritySources();
  const driftedAuthorities = [
    {
      expectedPath: '.cortex/gizmo/workflows/subagent-delegation.md',
      request: {
        ...sources,
        delegationSource: sources.delegationSource.replace(
          'It does not alias the structural identities and cannot\n  satisfy ordinary provider edges.',
          'It aliases the structural identities.',
        ),
      },
    },
    {
      expectedPath: '.cortex/teams/ai/architecture/refactoring-experts.md',
      request: {
        ...sources,
        registrySource: sources.registrySource.replace(
          'The third alternative is documentary only: no role/profile/result identity or\nruntime support exists, and ordinary dispatch remains fail-closed.',
          'The third alternative is implemented.',
        ),
      },
    },
    {
      expectedPath:
        '.cortex/teams/ai/design-docs/agent-workflow-orchestration.md',
      request: {
        ...sources,
        orchestrationSource: sources.orchestrationSource.replace(
          '## Static graph decision',
          '## Static graph decision drifted',
        ),
      },
    },
    {
      expectedPath:
        '.cortex/teams/ai/dynamic-skills/system-coherence-synthesizer.md',
      request: {
        ...sources,
        skillSource: sources.skillSource.replace(
          'Failed observations never count as accepted provider\nevidence, and the legacy output cannot satisfy an ordinary provider edge,',
          'Failed observations count as accepted provider evidence.',
        ),
      },
    },
    {
      expectedPath: '.cortex/teams/ai/references/loom-tools.md',
      request: {
        ...sources,
        toolsSource: sources.toolsSource.replace(
          '## Static agent workflow boundary',
          '## Static agent workflow boundary drifted',
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
    const findings = auditStructuralExpertCortexAuthority(drift.request);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'cortex-structural-expert-contract-semantic-drift' &&
          finding.path === drift.expectedPath,
      ),
    ).toBe(true);
  }
}

test('rejects semantic drift in structural read-only lifecycle boundaries', async () => {
  await expectAllAuthorityDriftCoverage();
  const sources = await cortexAuthoritySources();
  const registrySource = sources.registrySource.replace(
    'Every role is read-only and nondelegating.',
    'Every role may write and delegate.',
  );
  const authorityRequest = { ...sources, registrySource };

  expect(
    auditStructuralExpertCortexAuthority(authorityRequest).map(
      (finding) => finding.code,
    ),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('rejects drift in repository-reading evidence-surface requirements', async () => {
  const sources = await cortexAuthoritySources();
  const registrySource = sources.registrySource.replace(
    'The repository-reader category remains separate: each reader declares a non-\nempty repository evidence surface covered by its bounded read claims.',
    'The two repository-reading experts may inspect the repository.',
  );
  const authorityRequest = { ...sources, registrySource };

  expect(
    auditStructuralExpertCortexAuthority(authorityRequest).map(
      (finding) => finding.code,
    ),
  ).toContain('cortex-structural-expert-contract-semantic-drift');
});

test('rejects drift across the three distinct synthesis lanes', async () => {
  const sources = await cortexAuthoritySources();
  const forbiddenDrifts = [
    [
      '`system_coherence_synthesizer` is that legacy `loom-structural-experts` role.',
      '`system_coherence_synthesizer` is the ordinary synthesis role.',
    ],
    [
      'The static `loom:agent-workflow:cortex-audit` workflow instead uses its separate\n`FindingSynthesizer` profile and `CortexSynthesis` result.',
      'The static Cortex workflow aliases the structural aggregator.',
    ],
    [
      'Future ordinary accepted-evidence synthesis must use a distinct typed role,\nprofile, and result contract before implementation. None is named or registered\nhere, and ordinary dispatch remains fail-closed.',
      'Future ordinary synthesis reuses system_coherence_synthesizer.',
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
      auditStructuralExpertCortexAuthority(authorityRequest).map(
        (finding) => finding.code,
      ),
    ).toContain('cortex-structural-expert-contract-semantic-drift');
  }
});

test('rejects drift across authorization evidence alternatives', async () => {
  const sources = await cortexAuthoritySources();
  const authorizationAlternatives = [
    'a repository-reading expert binds the exact source commit, bounded read\n  claims, non-empty evidence surface, and exact evidence paths;',
    'the legacy `system_coherence_synthesizer` binds the exact\n  `loom-structural-experts` parent-authorized structural all-terminal\n  observation barrier, including each verified `StructuralExpertPlan` child\n  task, expert, attempt, `Completed` or `Failed` status, result/view identity,\n  digest, and inherited source provenance; or',
    'a future unnamed ordinary accepted-evidence role would bind generation-frozen\n  provider edges, expected producer identities, typed input schema, and\n  acceptance criteria, then exact accepted artifacts, digests, and provenance\n  when Gizmo authorizes its ready attempt.',
  ] as const;

  for (const alternative of authorizationAlternatives) {
    expect(sources.registrySource).toContain(alternative);
    const registrySource = sources.registrySource.replace(
      alternative,
      'authorization may use any available input.',
    );
    const authorityRequest = { ...sources, registrySource };
    expect(
      auditStructuralExpertCortexAuthority(authorityRequest).map(
        (finding) => finding.code,
      ),
    ).toContain('cortex-structural-expert-contract-semantic-drift');
  }
});

test('rejects drift that promotes either legacy diagnostic lane', async () => {
  const sources = await cortexAuthoritySources();
  const laneContracts = [
    [
      'Its `SystemCoherenceSynthesis` output is diagnostic-only. Neither an input\nfailure nor the aggregate can satisfy an ordinary provider edge, authorize\nimplementation, or establish compliance with ordinary accepted-evidence\nsynthesis.',
      'The structural aggregate satisfies ordinary provider edges.',
    ],
    [
      'Its all-terminal diagnostic aggregator is `FindingSynthesizer`, producing\n`CortexSynthesis`. These are separate from the `loom-structural-experts`\n`system_coherence_synthesizer` / `SystemCoherenceSynthesis` structural\ndiagnostic lane. Neither legacy lane satisfies ordinary provider edges.',
      'The Cortex aggregate satisfies ordinary provider edges.',
    ],
    [
      'The legacy all-terminal join waits for every declared terminal observation,\n    including failed lanes.',
      'The join accepts successful evidence only.',
    ],
  ] as const;

  for (const [requiredContract, drift] of laneContracts) {
    const registryContract = sources.registrySource.includes(requiredContract);
    const source = registryContract
      ? sources.registrySource
      : sources.orchestrationSource;
    expect(source).toContain(requiredContract);
    const authorityRequest = registryContract
      ? {
          ...sources,
          registrySource: source.replace(requiredContract, drift),
        }
      : {
          ...sources,
          orchestrationSource: source.replace(requiredContract, drift),
        };
    expect(
      auditStructuralExpertCortexAuthority(authorityRequest).map(
        (finding) => finding.code,
      ),
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
