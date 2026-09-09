import type { Result } from 'neverthrow';
import type { CortexArticleRequestDecodeError } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/decode-error.ts';
import type { Nodes } from 'mdast';
import { CortexMarkdownArticleNode } from './cortex-markdown-article-node.ts';

import remarkGfm from 'remark-gfm';

import remarkParse from 'remark-parse';

import { unified } from 'unified';

import { CortexArticleApplication } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/application.ts';

import {
  CortexArticleContractKind,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/domain.ts';

import type { CortexDocumentSource } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';

export class CortexMarkdownArticle {
  private constructor(
    private readonly request: AuditCortexArticleStructureArgs,
  ) {}
  static from(args: AuditCortexArticleStructureArgs): CortexMarkdownArticle {
    return new CortexMarkdownArticle(args);
  }
  execute(): Result<CortexArticleFinding[], CortexArticleRequestDecodeError> {
    const args = this.request;
    const documents = args.documents.map((document) => {
      const request: SemanticDocumentRequest = { document };
      return this.semanticDocument(request);
    });
    const request: AuditCortexArticleStructureRequest = {
      kind: CortexArticleContractKind.Request,
      documents,
    };
    return CortexArticleApplication.from(request)
      .execute()
      .map((result) => [...result.findings]);
  }

  private semanticDocument(
    request: SemanticDocumentRequest,
  ): CortexArticleDocument {
    const content = request.document.relativePath.endsWith('/SKILL.md')
      ? request.document.content.replace(
          /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,
          (frontmatter) => frontmatter.replace(/[^\r\n]/gu, ' '),
        )
      : request.document.content;
    const root = unified().use(remarkParse).use(remarkGfm).parse(content);
    const blocks = root.children.flatMap((node) => {
      const containerBlock = new CortexMarkdownArticleNode(
        node,
      ).semanticBlock();
      if (node.type === 'table') return [containerBlock];
      const tableBlocks: CortexArticleSemanticBlock[] = [];
      const tableRequest: CollectTableBlocksRequest = {
        node,
        blocks: tableBlocks,
      };
      this.collectTableBlocks(tableRequest);
      return [
        containerBlock,
        ...tableBlocks.map((tableBlock) =>
          // A nested table can share its container's opening line. Its delimiter
          // is the next source line and keeps the semantic transport ordered.
          tableBlock.line === containerBlock.line
            ? { ...tableBlock, line: tableBlock.line + 1 }
            : tableBlock,
        ),
      ];
    });
    return { relativePath: request.document.relativePath, blocks };
  }

  private collectTableBlocks(request: CollectTableBlocksRequest): void {
    if (request.node.type === 'table') {
      request.blocks.push({
        kind: CortexArticleSemanticKind.Table,
        line: request.node.position?.start.line ?? 1,
      });
      return;
    }
    if (!('children' in request.node)) return;
    for (const child of request.node.children) {
      const childRequest: CollectTableBlocksRequest = {
        node: child,
        blocks: request.blocks,
      };
      this.collectTableBlocks(childRequest);
    }
  }
}

export {
  CortexArticleFindingCode,
  type CortexArticleFinding,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/domain.ts';

export type AuditCortexArticleStructureArgs = {
  readonly documents: readonly CortexDocumentSource[];
};

type SemanticDocumentRequest = {
  readonly document: CortexDocumentSource;
};

type CollectTableBlocksRequest = {
  readonly node: Nodes;
  readonly blocks: CortexArticleSemanticBlock[];
};
