import { WorkflowResultKind } from '../agent-workflow/domain.ts';

export enum StructuralExpertKind {
  RepositoryEvidence = 'repository-evidence',
  VerifiedViewSynthesis = 'verified-view-synthesis',
}

export type StructuralExpertProfile = {
  readonly name: string;
  readonly description: string;
  readonly kind: StructuralExpertKind;
  readonly resultKind:
    | WorkflowResultKind.CodeRefactoringEvidence
    | WorkflowResultKind.CortexRefactoringEvidence
    | WorkflowResultKind.SystemCoherenceSynthesis;
  readonly agentDefinitionPath: string;
  readonly skillPath: string;
  readonly requiredContextPaths: readonly string[];
  readonly allowedEvidenceFiles: readonly string[];
  readonly allowedEvidenceDescendantRoots: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly runtimeBehaviorContract: string;
  readonly validationSelectors: readonly string[];
};

export const SYSTEM_COHERENCE_BEHAVIOR_CONTRACT = [
  'Act only as the assigned system_coherence_synthesizer.',
  'Use only the typed results, verified artifact references, and bounded semantic views supplied by the parent.',
  'Do not inspect the repository or create claims that are absent from supplied evidence.',
  'Deduplicate findings, preserve disagreements and failed-lane evidence, correlate code and Cortex drift, order providers before consumers, and propose independent edit groups with parent-owned joins.',
  'Do not edit files, apply patches, delegate, create descendants, schedule work, authorize writes, or mutate Git, GitHub, Workbench, CI, deployment, workflow processing, or other external state.',
].join('\n');

const COMMON_CONTEXT = [
  '.cortex/AGENTS.md',
  '.cortex/knowledge-graph.md',
  '.cortex/architecture/refactoring-experts.md',
  '.cortex/workflows/structural-refactoring.md',
  '.cortex/workflows/subagent-delegation.md',
] as const;

const CODE_REFACTORING_FILES = [
  'Taskfile.yml',
  '.github/formatting/format.sh',
  'tooling/eslint-rules/no-raw-object-arguments.js',
  'agentic-ai/loom/package.json',
  '.agents/skills/eslint.config.js',
  '.agents/skills/package.json',
  '.agents/skills/tsconfig.json',
  '.agents/skills/bun.lock',
  '.agents/skills/.prettierrc',
  '.agents/skills/typescript-named-args/tests/eslint-contract.test.ts',
] as const;

const CODE_REFACTORING_DESCENDANT_ROOTS = [
  '.github/scripts',
  '.github/workflows',
  '.task',
  'agentic-ai/loom/src',
  'agentic-ai/loom/tests',
  'nook-app/nook-platform',
  'nook-app/nook-web',
] as const;

const CORTEX_REFACTORING_FILES = [
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
] as const;

const CORTEX_REFACTORING_DESCENDANT_ROOTS = [
  '.agents/skills',
  '.cortex',
  '.github/workflows',
  '.task',
] as const;

export const STRUCTURAL_EXPERT_CATALOG: readonly StructuralExpertProfile[] = [
  {
    name: 'code_refactoring_expert',
    description:
      'Read-only evidence expert for architecture, design, code quality, stronger types, and tests in explicitly authorized code scopes.',
    kind: StructuralExpertKind.RepositoryEvidence,
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    agentDefinitionPath:
      '.codex/agents/structural-experts/code_refactoring_expert.toml',
    skillPath: '.agents/skills/code-refactoring-expert/SKILL.md',
    requiredContextPaths: COMMON_CONTEXT,
    allowedEvidenceFiles: CODE_REFACTORING_FILES,
    allowedEvidenceDescendantRoots: CODE_REFACTORING_DESCENDANT_ROOTS,
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
    kind: StructuralExpertKind.RepositoryEvidence,
    resultKind: WorkflowResultKind.CortexRefactoringEvidence,
    agentDefinitionPath:
      '.codex/agents/structural-experts/cortex_refactoring_expert.toml',
    skillPath: '.agents/skills/cortex-refactoring-expert/SKILL.md',
    requiredContextPaths: COMMON_CONTEXT,
    allowedEvidenceFiles: CORTEX_REFACTORING_FILES,
    allowedEvidenceDescendantRoots: CORTEX_REFACTORING_DESCENDANT_ROOTS,
    excludedPaths: ['.cortex/.session'],
    runtimeBehaviorContract: '',
    validationSelectors: ['loom:cortex-audit', 'loom:verify'],
  },
  {
    name: 'system_coherence_synthesizer',
    description:
      'Read-only synthesizer that reconciles only replay-verified child results and views without repository exploration.',
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    resultKind: WorkflowResultKind.SystemCoherenceSynthesis,
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

export function structuralExpertProfile(
  expertName: string,
): StructuralExpertProfile | false {
  return (
    STRUCTURAL_EXPERT_CATALOG.find(
      (candidate) => candidate.name === expertName,
    ) ?? false
  );
}
