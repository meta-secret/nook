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
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';

export {
  CortexCompatibilityEvidence,
  CortexContractFindingCode,
  CortexContextAuthorityDocument,
  CortexPolicyArea,
  CortexPolicyCapability,
  CortexPolicyContractKind,
  type CortexContractFinding,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';

export type CompileCortexContractsArgs = {
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
  const documents = adaptCortexContractDocuments(args.documents);
  const request: CompileCortexContractsRequest = {
    kind: CortexConsistencyContractKind.Request,
    documents,
  };
  return [...executeCortexConsistencyApplication(request).findings];
}

export function adaptCortexContractDocuments(
  documents: readonly CortexContractDocument[],
): SemanticCortexContractDocument[] {
  return documents.map((document) => ({
    relativePath: document.relativePath,
    references: markdownReferences(document.content),
  }));
}

function markdownReferences(content: string): readonly string[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(content);
  const definitions = new Map<string, string>();
  visitMarkdownNode({
    node: root,
    visitor: (node) => {
      if (node.type === 'definition') {
        const identifier = node.identifier.toUpperCase();
        if (!definitions.has(identifier)) definitions.set(identifier, node.url);
      }
    },
  });
  const collection: MarkdownReferenceCollection = {
    definitions,
    references: [],
  };
  visitMarkdownNode({
    node: root,
    visitor: (node) => collectMarkdownReference({ node, collection }),
  });
  return collection.references;
}

type CollectMarkdownReferenceArgs = {
  readonly node: Nodes;
  readonly collection: MarkdownReferenceCollection;
};

function collectMarkdownReference(args: CollectMarkdownReferenceArgs): void {
  if (args.node.type === 'link') {
    args.collection.references.push(args.node.url);
  } else if (args.node.type === 'linkReference') {
    const destination = args.collection.definitions.get(
      args.node.identifier.toUpperCase(),
    );
    if (destination) args.collection.references.push(destination);
  } else if (args.node.type === 'inlineCode') {
    args.collection.references.push(args.node.value);
  }
}

type VisitMarkdownNodeArgs = {
  readonly node: Nodes;
  readonly visitor: (node: Nodes) => void;
};

function visitMarkdownNode(args: VisitMarkdownNodeArgs): void {
  args.visitor(args.node);
  if (!('children' in args.node)) return;
  for (const child of args.node.children) {
    visitMarkdownNode({ ...args, node: child });
  }
}
