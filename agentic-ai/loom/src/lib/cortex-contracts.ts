import type { Nodes } from 'mdast';

import remarkGfm from 'remark-gfm';

import remarkParse from 'remark-parse';

import { unified } from 'unified';

import { CortexConsistencyApplication } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/application.ts';

import { CortexConsistencyContractKind } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';

import type {
  CompileCortexContractsRequest,
  CortexContractDocument as SemanticCortexContractDocument,
  CortexContractFinding,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';

export class CortexContractDocuments {
  private constructor(private readonly request: CompileCortexContractsArgs) {}

  static compileCortexContracts(
    args: CompileCortexContractsArgs,
  ): CortexContractFinding[] {
    return new CortexContractDocuments(args).execute();
  }

  private execute(): CortexContractFinding[] {
    const args = this.request;
    const documents = CortexContractDocuments.adaptCortexContractDocuments(
      args.documents,
    );
    const request: CompileCortexContractsRequest = {
      kind: CortexConsistencyContractKind.Request,
      documents,
    };
    return [...CortexConsistencyApplication.from(request).execute().findings];
  }

  static adaptCortexContractDocuments(
    documents: readonly CortexContractDocument[],
  ): SemanticCortexContractDocument[] {
    return documents.map(CortexContractDocuments.adaptCortexContractDocument);
  }

  private static adaptCortexContractDocument(
    document: CortexContractDocument,
  ): SemanticCortexContractDocument {
    const root = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(document.content);
    const definitions = new Map<string, string>();
    CortexContractDocuments.visitMarkdownNode({
      node: root,
      visitor: (node) => {
        if (node.type === 'definition') {
          const identifier = node.identifier.toUpperCase();
          if (!definitions.has(identifier))
            definitions.set(identifier, node.url);
        }
      },
    });
    const collection: MarkdownReferenceCollection = {
      definitions,
      references: [],
      commands: [],
    };
    CortexContractDocuments.visitMarkdownNode({
      node: root,
      visitor: (node) =>
        CortexContractDocuments.collectMarkdownReference({ node, collection }),
    });
    return {
      relativePath: document.relativePath,
      references: collection.references,
      commands: collection.commands,
    };
  }

  private static collectMarkdownReference(
    args: CollectMarkdownReferenceArgs,
  ): void {
    if (args.node.type === 'link') {
      args.collection.references.push(args.node.url);
    } else if (args.node.type === 'linkReference') {
      const destination = args.collection.definitions.get(
        args.node.identifier.toUpperCase(),
      );
      if (destination) args.collection.references.push(destination);
    } else if (args.node.type === 'inlineCode') {
      args.collection.references.push(args.node.value);
      args.collection.commands.push(args.node.value);
    } else if (args.node.type === 'code') {
      args.collection.commands.push(...args.node.value.split('\n'));
    }
  }

  private static visitMarkdownNode(args: VisitMarkdownNodeArgs): void {
    args.visitor(args.node);
    if (!('children' in args.node)) return;
    for (const child of args.node.children) {
      CortexContractDocuments.visitMarkdownNode({ ...args, node: child });
    }
  }
}

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
  readonly commands: string[];
};

type CollectMarkdownReferenceArgs = {
  readonly node: Nodes;
  readonly collection: MarkdownReferenceCollection;
};

type VisitMarkdownNodeArgs = {
  readonly node: Nodes;
  readonly visitor: (node: Nodes) => void;
};
