import {
  CortexContractContextId,
  CortexContractTeam,
  CortexPolicyArea,
  CortexPolicyScopeKind,
  type CortexContractRegistry,
} from './cortex-contracts.ts';

export enum RegisteredCortexPolicyPath {
  ArticleStructure = '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
  Consistency = '.cortex/teams/ai/dynamic-skills/cortex-consistency.md',
  Writer = '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
}

const GENERAL_SCOPE = { kind: CortexPolicyScopeKind.General } as const;

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
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
      scopes: [GENERAL_SCOPE],
    },
    {
      owner: CortexContractTeam.Ai,
      document: RegisteredCortexPolicyPath.ArticleStructure,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
      scopes: [GENERAL_SCOPE],
    },
    {
      owner: CortexContractTeam.Ai,
      document: RegisteredCortexPolicyPath.Consistency,
      areas: [CortexPolicyArea.CortexAuthoring],
      capabilities: [],
      scopes: [GENERAL_SCOPE],
    },
  ],
} as const satisfies CortexContractRegistry;
