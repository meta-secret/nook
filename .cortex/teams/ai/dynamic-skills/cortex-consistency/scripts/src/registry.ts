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
} as const satisfies CortexContractRegistry;
