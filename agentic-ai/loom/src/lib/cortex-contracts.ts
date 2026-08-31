import type { Nodes } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { executeCortexConsistencyApplication } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/application.ts';
import { CortexConsistencyContractKind } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';
import type {
  CompileCortexContractsRequest,
  CortexContractDocument as SemanticCortexContractDocument,
  CortexContractFinding,
  CortexContractRegistry,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';

export {
  CortexCompatibilityEvidence,
  CortexContractFindingCode,
  CortexPolicyArea,
  CortexPolicyCapability,
  CortexPolicyContractKind,
  type CortexContractFinding,
  type CortexContractRegistry,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';
export { CORTEX_CONTRACT_REGISTRY } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/registry.ts';

export type CompileCortexContractsArgs = {
  readonly registry: CortexContractRegistry;
  readonly documents: readonly CortexContractDocument[];
};

export type CortexContractDocument = {
  readonly relativePath: string;
  readonly content: string;
};

type MarkdownReferenceCollection = {
  readonly definitions: ReadonlyMap<string, string>;
  readonly references: string[];
};

export function compileCortexContracts(
  args: CompileCortexContractsArgs,
): CortexContractFinding[] {
  const documents: SemanticCortexContractDocument[] = args.documents.map(
    (document) => ({
      relativePath: document.relativePath,
      references: markdownReferences(document.content),
    }),
  );
  const request: CompileCortexContractsRequest = {
    kind: CortexConsistencyContractKind.Request,
    registry: args.registry,
    documents,
  };
  return [...executeCortexConsistencyApplication(request).findings];
}

function markdownReferences(content: string): readonly string[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(content);
  const definitions = new Map<string, string>();
  visitMarkdownNode(root, (node) => {
    if (node.type === 'definition') {
      definitions.set(node.identifier.toUpperCase(), node.url);
    }
  });
  const collection: MarkdownReferenceCollection = {
    definitions,
    references: [],
  };
  visitMarkdownNode(root, (node) => collectMarkdownReference(node, collection));
  return collection.references;
}

function collectMarkdownReference(
  node: Nodes,
  collection: MarkdownReferenceCollection,
): void {
  if (node.type === 'link') {
    collection.references.push(node.url);
  } else if (node.type === 'linkReference') {
    const destination = collection.definitions.get(
      node.identifier.toUpperCase(),
    );
    if (destination) collection.references.push(destination);
  } else if (node.type === 'inlineCode') {
    collection.references.push(node.value);
  }
}

function visitMarkdownNode(node: Nodes, visitor: (node: Nodes) => void): void {
  visitor(node);
  if (!('children' in node)) return;
  for (const child of node.children) visitMarkdownNode(child, visitor);
}
