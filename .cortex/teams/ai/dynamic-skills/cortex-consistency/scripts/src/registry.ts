import {
  CortexContextAuthorityDocument,
  CortexPolicyContractKind,
  CortexPolicyArea,
  type CortexContractRegistry,
} from './domain.ts';

export enum RegisteredCortexPolicyPath {
  ArticleStructure = '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
  Consistency = '.cortex/teams/ai/dynamic-skills/cortex-consistency/SKILL.md',
  Writer = '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
}

export enum RegisteredCortexRuntimeDocument {
  NativeSubagentDelegation = '.cortex/gizmo/workflows/subagent-delegation.md',
}

export enum RegisteredCortexRuntimeCommand {
  StaticSkillHost = 'task skills:run',
  DelegationVisualization = 'task loom:delegation-visualization',
  DelegationJournalBinary = 'loom-agent-delegation',
  DelegationJournalTask = 'task loom:agent-delegation',
}

export const CORTEX_CONTRACT_REGISTRY = {
  contexts: [
    {
      authorityDocument: CortexContextAuthorityDocument.Root,
      ownsAreas: [CortexPolicyArea.CortexAuthoring],
      imports: [
        RegisteredCortexPolicyPath.Writer,
        RegisteredCortexPolicyPath.ArticleStructure,
        RegisteredCortexPolicyPath.Consistency,
      ],
    },
  ],
  policies: [
    {
      document: RegisteredCortexPolicyPath.Writer,
      kind: CortexPolicyContractKind.General,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
    },
    {
      document: RegisteredCortexPolicyPath.ArticleStructure,
      kind: CortexPolicyContractKind.General,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
    },
    {
      document: RegisteredCortexPolicyPath.Consistency,
      kind: CortexPolicyContractKind.General,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
    },
  ],
  runtimes: [
    {
      document: RegisteredCortexRuntimeDocument.NativeSubagentDelegation,
      allowedCommandPrefixes: [
        RegisteredCortexRuntimeCommand.DelegationVisualization,
      ],
      requiredCommandPrefixes: [
        RegisteredCortexRuntimeCommand.DelegationVisualization,
      ],
      retiredCommandPrefixes: [
        RegisteredCortexRuntimeCommand.StaticSkillHost,
        RegisteredCortexRuntimeCommand.DelegationJournalBinary,
        RegisteredCortexRuntimeCommand.DelegationJournalTask,
      ],
    },
  ],
} as const satisfies CortexContractRegistry;
