import {
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  JoinCompletionPolicy,
  LoomLeafKind,
  StaticAgentWorkflowName,
  TaskTargetKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
  noTasks,
} from './domain.ts';

import type {
  ParallelTaskTarget,
  StaticAgentWorkflowDefinition,
  TaskResourceClaims,
} from './domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from './agent-attempt-version.ts';

export enum CortexAuditAgent {
  WorkflowAuditor = 'workflow-auditor',
  ArchitectureAuditor = 'architecture-auditor',
  SkillAuditor = 'skill-auditor',
  RuntimeAuditor = 'runtime-auditor',
  FindingSynthesizer = 'finding-synthesizer',
}

export enum CortexAuditTask {
  ResolveBaseline = 'resolve-baseline',
  AuditWorkflowsAndReferences = 'audit-workflows-and-references',
  AuditDesignDocsAndProductSpecs = 'audit-design-docs-and-product-specs',
  AuditDynamicSkillsAndEntryPoints = 'audit-dynamic-skills-and-entry-points',
  AuditRuntimeTaskAndCi = 'audit-runtime-task-and-ci',
  SynthesizeFindings = 'synthesize-findings',
  MechanicalCortexAudit = 'mechanical-cortex-audit',
}

export enum CortexAuditJoin {
  EvidenceCollected = 'evidence-collected',
}

const READ_ONLY_CORTEX: TaskResourceClaims = {
  read: ['.cortex/**', '.agents/skills/**'],
  write: [],
};

const READ_ONLY_SKILLS: TaskResourceClaims = {
  read: ['.cortex/**', '.agents/**', '.cursor/**', '.claude/**', 'AGENTS.md'],
  write: [],
};

const READ_ONLY_ARCHITECTURE: TaskResourceClaims = {
  read: ['.cortex/**', 'nook-app/**'],
  write: [],
};

const READ_ONLY_RUNTIME: TaskResourceClaims = {
  read: [
    '.cortex/**',
    '.github/**',
    '.task/**',
    'agentic-ai/**',
    'infra/**',
    'nook-app/**',
    'preflight/**',
    'Taskfile.yml',
    '**/Taskfile.yml',
  ],
  write: [],
};

const READ_ONLY_GIT_BASELINE: TaskResourceClaims = {
  read: ['git:HEAD', 'git:index', 'git:worktree'],
  write: [],
};

const AUDIT_PARTITIONS: ParallelTaskTarget<CortexAuditTask> = {
  kind: TaskTargetKind.Parallel,
  tasks: [
    CortexAuditTask.AuditWorkflowsAndReferences,
    CortexAuditTask.AuditDesignDocsAndProductSpecs,
    CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
    CortexAuditTask.AuditRuntimeTaskAndCi,
    CortexAuditTask.MechanicalCortexAudit,
  ],
};

export const CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW: StaticAgentWorkflowDefinition<
  CortexAuditTask,
  CortexAuditAgent,
  CortexAuditJoin
> = {
  name: StaticAgentWorkflowName.CortexFullGarbageCollection,
  version: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
  entry: CortexAuditTask.ResolveBaseline,
  materializedViewTask: CortexAuditTask.SynthesizeFindings,
  taskNames: [
    CortexAuditTask.ResolveBaseline,
    CortexAuditTask.AuditWorkflowsAndReferences,
    CortexAuditTask.AuditDesignDocsAndProductSpecs,
    CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
    CortexAuditTask.AuditRuntimeTaskAndCi,
    CortexAuditTask.SynthesizeFindings,
    CortexAuditTask.MechanicalCortexAudit,
  ],
  agentNames: [
    CortexAuditAgent.WorkflowAuditor,
    CortexAuditAgent.ArchitectureAuditor,
    CortexAuditAgent.SkillAuditor,
    CortexAuditAgent.RuntimeAuditor,
    CortexAuditAgent.FindingSynthesizer,
  ],
  joinNames: [CortexAuditJoin.EvidenceCollected],
  agents: {
    [CortexAuditAgent.WorkflowAuditor]: {
      name: CortexAuditAgent.WorkflowAuditor,
      instructionPrefix: 'Audit active workflow policy as read-only evidence.',
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.Medium,
    },
    [CortexAuditAgent.ArchitectureAuditor]: {
      name: CortexAuditAgent.ArchitectureAuditor,
      instructionPrefix: 'Audit durable architecture as read-only evidence.',
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.High,
    },
    [CortexAuditAgent.SkillAuditor]: {
      name: CortexAuditAgent.SkillAuditor,
      instructionPrefix:
        'Audit dynamic skills and their entry points as read-only evidence.',
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.High,
    },
    [CortexAuditAgent.RuntimeAuditor]: {
      name: CortexAuditAgent.RuntimeAuditor,
      instructionPrefix:
        'Audit executable repository evidence as read-only evidence.',
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.High,
    },
    [CortexAuditAgent.FindingSynthesizer]: {
      name: CortexAuditAgent.FindingSynthesizer,
      instructionPrefix:
        'Reconcile bounded evidence without editing repository files.',
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: AgentReasoningEffort.High,
    },
  },
  tasks: {
    [CortexAuditTask.ResolveBaseline]: {
      name: CortexAuditTask.ResolveBaseline,
      execution: {
        kind: WorkflowExecutorKind.LoomLeaf,
        leaf: LoomLeafKind.VerifyGitBaseline,
      },
      completed: AUDIT_PARTITIONS,
      failed: noTasks,
      resources: READ_ONLY_GIT_BASELINE,
      timeoutMs: 30_000,
    },
    [CortexAuditTask.AuditWorkflowsAndReferences]: {
      name: CortexAuditTask.AuditWorkflowsAndReferences,
      execution: {
        kind: WorkflowExecutorKind.Agent,
        agent: CortexAuditAgent.WorkflowAuditor,
        instruction:
          'Use .cortex/knowledge-graph.md to route this AI-team audit. Inspect only .cortex/teams/ai/workflows and .cortex/teams/ai/references. Load a named shared or SRE authority only when one workflow directly depends on it. Find obsolete rules, conflicting ordering, broken ownership boundaries, commands that disagree with code, duplicated procedures, deterministic leaf candidates, compiled workflow candidates, and safe parallel evidence lanes. Identify policy that must remain semantic judgment. Return precise file and line evidence. Do not edit files.',
        resultKind: WorkflowResultKind.CortexEvidence,
      },
      completed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      failed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      resources: READ_ONLY_CORTEX,
      timeoutMs: 20 * 60_000,
    },
    [CortexAuditTask.AuditDesignDocsAndProductSpecs]: {
      name: CortexAuditTask.AuditDesignDocsAndProductSpecs,
      execution: {
        kind: WorkflowExecutorKind.Agent,
        agent: CortexAuditAgent.ArchitectureAuditor,
        instruction:
          'Use .cortex/knowledge-graph.md to select one owning team before inspection. Within that team, inspect only task-relevant design documents and product specifications. Load one named shared authority only when required by the selected contract. Compare active claims with their owning implementation and workflow policy. Do not scan every team tree. Return precise file and line evidence. Do not edit files.',
        resultKind: WorkflowResultKind.CortexEvidence,
      },
      completed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      failed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      resources: READ_ONLY_ARCHITECTURE,
      timeoutMs: 20 * 60_000,
    },
    [CortexAuditTask.AuditDynamicSkillsAndEntryPoints]: {
      name: CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
      execution: {
        kind: WorkflowExecutorKind.Agent,
        agent: CortexAuditAgent.SkillAuditor,
        instruction:
          'Use the AI knowledge graph to inspect its dynamic-skill catalog and only the exact team or shared skill cards named by that catalog. Compare those cards with .agents/skills, .cursor executable mirrors, .claude executable mirrors, .cortex/AGENTS.md, and AGENTS.md. Do not preload all team graphs or all Cortex documents. Find stale skills, missing or divergent wrappers and mirrors, and entry-point guidance that disagrees with durable skill cards. Return precise file and line evidence. Do not edit files.',
        resultKind: WorkflowResultKind.CortexEvidence,
      },
      completed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      failed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      resources: READ_ONLY_SKILLS,
      timeoutMs: 20 * 60_000,
    },
    [CortexAuditTask.AuditRuntimeTaskAndCi]: {
      name: CortexAuditTask.AuditRuntimeTaskAndCi,
      execution: {
        kind: WorkflowExecutorKind.Agent,
        agent: CortexAuditAgent.RuntimeAuditor,
        instruction:
          'Compare Cortex claims with agentic-ai, Taskfile entrypoints, and GitHub Actions. Find stale package, command, lifecycle, and execution claims. Return precise file and line evidence. Do not edit files.',
        resultKind: WorkflowResultKind.CortexEvidence,
      },
      completed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      failed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      resources: READ_ONLY_RUNTIME,
      timeoutMs: 20 * 60_000,
    },
    [CortexAuditTask.SynthesizeFindings]: {
      name: CortexAuditTask.SynthesizeFindings,
      execution: {
        kind: WorkflowExecutorKind.Agent,
        agent: CortexAuditAgent.FindingSynthesizer,
        instruction:
          'Reconcile every child materialized view into the root aggregate view. Deduplicate findings, preserve disagreements and failed-lane evidence, identify contradictions, classify workflow instructions as semantic policy, deterministic leaves, bounded agent tasks, compiled workflow candidates, delivery-owner actions, or ephemeral guidance, and propose the smallest consistent corrections. Name safe parallel groups and parent-owned joins. The authored Markdown is the parent read model. Do not edit files or mutate lifecycle state.',
        resultKind: WorkflowResultKind.CortexSynthesis,
      },
      completed: noTasks,
      failed: noTasks,
      resources: READ_ONLY_CORTEX,
      timeoutMs: 20 * 60_000,
    },
    [CortexAuditTask.MechanicalCortexAudit]: {
      name: CortexAuditTask.MechanicalCortexAudit,
      execution: {
        kind: WorkflowExecutorKind.LoomLeaf,
        leaf: LoomLeafKind.CortexAudit,
        includeDensityLint: false,
      },
      completed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      failed: {
        kind: TaskTargetKind.Join,
        join: CortexAuditJoin.EvidenceCollected,
      },
      resources: READ_ONLY_CORTEX,
      timeoutMs: 60_000,
    },
  },
  joins: {
    [CortexAuditJoin.EvidenceCollected]: {
      name: CortexAuditJoin.EvidenceCollected,
      policy: JoinCompletionPolicy.AllTerminal,
      arrivals: [
        CortexAuditTask.AuditWorkflowsAndReferences,
        CortexAuditTask.AuditDesignDocsAndProductSpecs,
        CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
        CortexAuditTask.AuditRuntimeTaskAndCi,
        CortexAuditTask.MechanicalCortexAudit,
      ],
      completed: {
        kind: TaskTargetKind.Task,
        task: CortexAuditTask.SynthesizeFindings,
      },
    },
  },
};
