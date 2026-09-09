import type { Nodes, RootContent } from 'mdast';

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
  static audit(args: AuditCortexArticleStructureArgs): CortexArticleFinding[] {
    return new CortexMarkdownArticle(args).execute();
  }
  private execute(): CortexArticleFinding[] {
    const args = this.request;
    const documents = args.documents.map((document) => {
      const request: SemanticDocumentRequest = { document };
      return this.semanticDocument(request);
    });
    const request: AuditCortexArticleStructureRequest = {
      kind: CortexArticleContractKind.Request,
      documents,
    };
    return [
      ...CortexArticleApplication.executeCortexArticleStructureApplication(
        request,
      ).findings,
    ];
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
      const blockRequest: SemanticBlockRequest = { node };
      const containerBlock = this.semanticBlock(blockRequest);
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

  private semanticBlock(
    request: SemanticBlockRequest,
  ): CortexArticleSemanticBlock {
    const line = this.nodeLine(request.node);
    if (request.node.type === 'table') {
      return { kind: CortexArticleSemanticKind.Table, line };
    }
    if (request.node.type === 'heading') {
      return {
        kind: CortexArticleSemanticKind.Heading,
        depth: request.node.depth,
        line,
        text: this.nodeText(request.node),
      };
    }
    if (this.isTransparentArticleNode(request.node)) {
      return { kind: CortexArticleSemanticKind.Transparent, line };
    }
    if (request.node.type === 'thematicBreak') {
      return { kind: CortexArticleSemanticKind.DensitySeparator, line };
    }
    if (request.node.type === 'paragraph') {
      if (!this.isVisibleArticleNode(request.node)) {
        return { kind: CortexArticleSemanticKind.Transparent, line };
      }
      return {
        kind: this.hasVisibleProseContent(request.node)
          ? CortexArticleSemanticKind.Paragraph
          : CortexArticleSemanticKind.Structure,
        line,
      };
    }
    if (!this.isVisibleArticleNode(request.node)) {
      return { kind: CortexArticleSemanticKind.Transparent, line };
    }
    return {
      kind: this.hasVisibleOrderedProcedureList(request.node)
        ? CortexArticleSemanticKind.VisibleOrderedList
        : CortexArticleSemanticKind.Structure,
      line,
    };
  }

  private collectTableBlocks(request: CollectTableBlocksRequest): void {
    if (request.node.type === 'table') {
      request.blocks.push({
        kind: CortexArticleSemanticKind.Table,
        line: this.nodeLine(request.node),
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

  private isVisibleArticleNode(node: RootContent): boolean {
    if (node.type === 'heading' || this.isTransparentArticleNode(node))
      return false;
    const inspection: MarkdownContentInspection = {
      excludeProcedureExamples: false,
      node,
    };
    return this.hasVisibleMarkdownContent(inspection);
  }

  private isTransparentArticleNode(node: RootContent): boolean {
    return node.type === 'definition' || node.type === 'footnoteDefinition';
  }

  private hasVisibleOrderedProcedureList(node: Nodes): boolean {
    if (
      node.type === 'blockquote' ||
      node.type === 'code' ||
      node.type === 'footnoteDefinition' ||
      node.type === 'html'
    ) {
      return false;
    }
    if (node.type === 'list' && node.ordered === true) {
      const inspection: MarkdownContentInspection = {
        excludeProcedureExamples: true,
        node,
      };
      if (this.hasVisibleMarkdownContent(inspection)) return true;
    }
    if (!('children' in node)) return false;
    return node.children.some((value) =>
      this.hasVisibleOrderedProcedureList(value),
    );
  }

  private hasVisibleMarkdownContent(
    request: MarkdownContentInspection,
  ): boolean {
    const node = request.node;
    if (
      request.excludeProcedureExamples &&
      (node.type === 'blockquote' || node.type === 'code')
    ) {
      return false;
    }
    if (
      node.type === 'definition' ||
      node.type === 'footnoteDefinition' ||
      node.type === 'heading' ||
      node.type === 'html' ||
      node.type === 'thematicBreak' ||
      node.type === 'break'
    ) {
      return false;
    }
    if (
      node.type === 'image' ||
      node.type === 'imageReference' ||
      node.type === 'footnoteReference'
    ) {
      return true;
    }
    if (
      !request.excludeProcedureExamples &&
      node.type === 'listItem' &&
      typeof node.checked === 'boolean'
    ) {
      return true;
    }
    if ('value' in node && typeof node.value === 'string') {
      return this.visibleText(node.value);
    }
    if (!('children' in node)) return false;
    return node.children.some((child) => {
      const childRequest: MarkdownContentInspection = {
        excludeProcedureExamples: request.excludeProcedureExamples,
        node: child,
      };
      return this.hasVisibleMarkdownContent(childRequest);
    });
  }

  private hasVisibleProseContent(node: Nodes): boolean {
    if (
      node.type === 'definition' ||
      node.type === 'footnoteDefinition' ||
      node.type === 'footnoteReference' ||
      node.type === 'heading' ||
      node.type === 'html' ||
      node.type === 'image' ||
      node.type === 'imageReference' ||
      node.type === 'thematicBreak' ||
      node.type === 'break'
    ) {
      return false;
    }
    if ('value' in node && typeof node.value === 'string') {
      return this.visibleText(node.value);
    }
    if (!('children' in node)) return false;
    return node.children.some((value) => this.hasVisibleProseContent(value));
  }

  private visibleText(value: string): boolean {
    return value.replaceAll(INVISIBLE_TEXT, '').length > 0;
  }

  private nodeText(node: RootContent): string {
    if ('value' in node && typeof node.value === 'string') return node.value;
    if (!('children' in node)) return '';
    return node.children.map((value) => this.nodeText(value)).join('');
  }

  private nodeLine(node: Nodes): number {
    const [line = 1] = [node.position?.start.line];
    return line;
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

type SemanticBlockRequest = {
  readonly node: RootContent;
};

type MarkdownContentInspection = {
  readonly node: Nodes;
  readonly excludeProcedureExamples: boolean;
};

type CollectTableBlocksRequest = {
  readonly node: Nodes;
  readonly blocks: CortexArticleSemanticBlock[];
};

const INVISIBLE_TEXT = /[\s\p{Default_Ignorable_Code_Point}]/gu;
