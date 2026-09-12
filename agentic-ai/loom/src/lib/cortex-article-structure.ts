import type { Nodes } from 'mdast';

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

enum MarkdownArticlePresence {
  Present = 'present',
  Absent = 'absent',
}

enum MarkdownArticleContentRole {
  Hidden = 'hidden',
  Intrinsic = 'intrinsic',
  Example = 'example',
  Inspect = 'inspect',
}

enum MarkdownProcedureTraversal {
  Excluded = 'excluded',
  Inspect = 'inspect',
}

enum MarkdownArticleInspectionMode {
  VisibleBody = 'visible-body',
  ProcedureActions = 'procedure-actions',
}

class CortexMarkdownNodeKind {
  constructor(private readonly kind: Nodes['type']) {}

  transparency(): MarkdownArticlePresence {
    return this.kind === 'definition' || this.kind === 'footnoteDefinition'
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  procedureTraversal(): MarkdownProcedureTraversal {
    if (
      this.kind === 'blockquote' ||
      this.kind === 'code' ||
      this.kind === 'footnoteDefinition' ||
      this.kind === 'html'
    )
      return MarkdownProcedureTraversal.Excluded;
    return MarkdownProcedureTraversal.Inspect;
  }

  contentRole(): MarkdownArticleContentRole {
    if (
      this.kind === 'definition' ||
      this.kind === 'footnoteDefinition' ||
      this.kind === 'heading' ||
      this.kind === 'html' ||
      this.kind === 'thematicBreak' ||
      this.kind === 'break'
    )
      return MarkdownArticleContentRole.Hidden;
    if (
      this.kind === 'image' ||
      this.kind === 'imageReference' ||
      this.kind === 'footnoteReference'
    )
      return MarkdownArticleContentRole.Intrinsic;
    if (this.kind === 'blockquote' || this.kind === 'code')
      return MarkdownArticleContentRole.Example;
    return MarkdownArticleContentRole.Inspect;
  }

  proseRole(): MarkdownArticleContentRole {
    if (
      this.kind === 'image' ||
      this.kind === 'imageReference' ||
      this.kind === 'footnoteReference'
    )
      return MarkdownArticleContentRole.Hidden;
    return this.contentRole();
  }
}

class CortexMarkdownArticleNode {
  private readonly kind: CortexMarkdownNodeKind;

  constructor(private readonly node: Nodes) {
    this.kind = new CortexMarkdownNodeKind(node.type);
  }

  semanticBlock(): CortexArticleSemanticBlock {
    const line = this.nodeLine();
    if (this.node.type === 'table') {
      return { kind: CortexArticleSemanticKind.Table, line };
    }
    if (this.node.type === 'heading') {
      return {
        kind: CortexArticleSemanticKind.Heading,
        depth: this.node.depth,
        line,
        text: this.nodeText(),
      };
    }
    if (this.kind.transparency() === MarkdownArticlePresence.Present) {
      return { kind: CortexArticleSemanticKind.Transparent, line };
    }
    if (this.node.type === 'thematicBreak') {
      return { kind: CortexArticleSemanticKind.DensitySeparator, line };
    }
    if (this.node.type === 'paragraph') {
      if (this.bodyVisibility() === MarkdownArticlePresence.Absent) {
        return { kind: CortexArticleSemanticKind.Transparent, line };
      }
      return {
        kind:
          this.proseVisibility() === MarkdownArticlePresence.Present
            ? CortexArticleSemanticKind.Paragraph
            : CortexArticleSemanticKind.Structure,
        line,
      };
    }
    if (this.bodyVisibility() === MarkdownArticlePresence.Absent) {
      return { kind: CortexArticleSemanticKind.Transparent, line };
    }
    return {
      kind:
        this.orderedActions() === MarkdownArticlePresence.Present
          ? CortexArticleSemanticKind.VisibleOrderedList
          : CortexArticleSemanticKind.Structure,
      line,
    };
  }

  private bodyVisibility(): MarkdownArticlePresence {
    const node = this.node;
    if (
      node.type === 'heading' ||
      this.kind.transparency() === MarkdownArticlePresence.Present
    )
      return MarkdownArticlePresence.Absent;
    return this.contentVisibility(MarkdownArticleInspectionMode.VisibleBody);
  }

  private orderedActions(): MarkdownArticlePresence {
    const node = this.node;
    if (
      this.kind.procedureTraversal() === MarkdownProcedureTraversal.Excluded
    ) {
      return MarkdownArticlePresence.Absent;
    }
    if (node.type === 'list' && node.ordered === true) {
      if (
        this.contentVisibility(
          MarkdownArticleInspectionMode.ProcedureActions,
        ) === MarkdownArticlePresence.Present
      )
        return MarkdownArticlePresence.Present;
    }
    if (!('children' in node)) return MarkdownArticlePresence.Absent;
    return node.children.some(
      (value) =>
        new CortexMarkdownArticleNode(value).orderedActions() ===
        MarkdownArticlePresence.Present,
    )
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  private contentVisibility(
    mode: MarkdownArticleInspectionMode,
  ): MarkdownArticlePresence {
    const node = this.node;
    const role = this.kind.contentRole();
    if (
      role === MarkdownArticleContentRole.Example &&
      mode === MarkdownArticleInspectionMode.ProcedureActions
    ) {
      return MarkdownArticlePresence.Absent;
    }
    if (role === MarkdownArticleContentRole.Hidden)
      return MarkdownArticlePresence.Absent;
    if (role === MarkdownArticleContentRole.Intrinsic)
      return MarkdownArticlePresence.Present;
    if (
      mode === MarkdownArticleInspectionMode.VisibleBody &&
      node.type === 'listItem' &&
      typeof node.checked === 'boolean'
    ) {
      return MarkdownArticlePresence.Present;
    }
    if ('value' in node && typeof node.value === 'string') {
      return this.visibleText(node.value)
        ? MarkdownArticlePresence.Present
        : MarkdownArticlePresence.Absent;
    }
    if (!('children' in node)) return MarkdownArticlePresence.Absent;
    return node.children.some(
      (child) =>
        new CortexMarkdownArticleNode(child).contentVisibility(mode) ===
        MarkdownArticlePresence.Present,
    )
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  private proseVisibility(): MarkdownArticlePresence {
    const node = this.node;
    if (this.kind.proseRole() === MarkdownArticleContentRole.Hidden) {
      return MarkdownArticlePresence.Absent;
    }
    if ('value' in node && typeof node.value === 'string') {
      return this.visibleText(node.value)
        ? MarkdownArticlePresence.Present
        : MarkdownArticlePresence.Absent;
    }
    if (!('children' in node)) return MarkdownArticlePresence.Absent;
    return node.children.some(
      (value) =>
        new CortexMarkdownArticleNode(value).proseVisibility() ===
        MarkdownArticlePresence.Present,
    )
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  private visibleText(value: string): boolean {
    return value.replaceAll(INVISIBLE_TEXT, '').length > 0;
  }

  private nodeText(): string {
    const node = this.node;
    if ('value' in node && typeof node.value === 'string') return node.value;
    if (!('children' in node)) return '';
    return node.children
      .map((value) => new CortexMarkdownArticleNode(value).nodeText())
      .join('');
  }

  private nodeLine(): number {
    const node = this.node;
    const [line = 1] = [node.position?.start.line];
    return line;
  }
}

const INVISIBLE_TEXT = /[\s\p{Default_Ignorable_Code_Point}]/gu;

export class CortexMarkdownArticle {
  private constructor(
    private readonly request: AuditCortexArticleStructureArgs,
  ) {}
  static from(args: AuditCortexArticleStructureArgs): CortexMarkdownArticle {
    return new CortexMarkdownArticle(args);
  }
  execute() {
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
      const position = request.node.position;
      request.blocks.push({
        kind: CortexArticleSemanticKind.Table,
        line: position ? position.start.line : 1,
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
