import {
  CortexContractContextId,
  CortexContractTeam,
  CortexPolicyContractKind,
  CortexPolicyArea,
  type CortexContractRegistry,
} from './cortex-contracts.ts';

export enum RegisteredCortexPolicyPath {
  ArticleStructure = '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
  Consistency = '.cortex/teams/ai/dynamic-skills/cortex-consistency.md',
  Writer = '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
}

export const CORTEX_CONTRACT_REGISTRY = {
  contexts: [
    {
      id: CortexContractContextId.RootAuthoring,
      owner: CortexContractTeam.GizmoPrime,
      authorityDocument: '.cortex/AGENTS.md',
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
      owner: CortexContractTeam.Ai,
      document: RegisteredCortexPolicyPath.Writer,
      kind: CortexPolicyContractKind.General,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
    },
    {
      owner: CortexContractTeam.Ai,
      document: RegisteredCortexPolicyPath.ArticleStructure,
      kind: CortexPolicyContractKind.General,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
    },
    {
      owner: CortexContractTeam.Ai,
      document: RegisteredCortexPolicyPath.Consistency,
      kind: CortexPolicyContractKind.General,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
    },
  ],
} as const satisfies CortexContractRegistry;
