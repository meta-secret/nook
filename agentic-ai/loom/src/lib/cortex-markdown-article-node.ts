import type { Nodes } from 'mdast';
import {
  CortexArticleSemanticKind,
  type CortexArticleSemanticBlock,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/domain.ts';

enum MarkdownArticlePresence {
  Present = 'present',
  Absent = 'absent',
}
enum MarkdownArticleInspectionMode {
  VisibleBody = 'visible-body',
  ProcedureActions = 'procedure-actions',
}

export class CortexMarkdownArticleNode {
  constructor(private readonly node: Nodes) {}
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
    if (this.transparency() === MarkdownArticlePresence.Present) {
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
      this.transparency() === MarkdownArticlePresence.Present
    )
      return MarkdownArticlePresence.Absent;
    return this.contentVisibility(MarkdownArticleInspectionMode.VisibleBody);
  }

  private transparency(): MarkdownArticlePresence {
    const node = this.node;
    return node.type === 'definition' || node.type === 'footnoteDefinition'
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  private orderedActions(): MarkdownArticlePresence {
    const node = this.node;
    if (
      node.type === 'blockquote' ||
      node.type === 'code' ||
      node.type === 'footnoteDefinition' ||
      node.type === 'html'
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
    if (
      mode === MarkdownArticleInspectionMode.ProcedureActions &&
      (node.type === 'blockquote' || node.type === 'code')
    ) {
      return MarkdownArticlePresence.Absent;
    }
    if (
      node.type === 'definition' ||
      node.type === 'footnoteDefinition' ||
      node.type === 'heading' ||
      node.type === 'html' ||
      node.type === 'thematicBreak' ||
      node.type === 'break'
    ) {
      return MarkdownArticlePresence.Absent;
    }
    if (
      node.type === 'image' ||
      node.type === 'imageReference' ||
      node.type === 'footnoteReference'
    ) {
      return MarkdownArticlePresence.Present;
    }
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
    return node.children.some((child) => {
      return (
        new CortexMarkdownArticleNode(child).contentVisibility(mode) ===
        MarkdownArticlePresence.Present
      );
    })
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  private proseVisibility(): MarkdownArticlePresence {
    const node = this.node;
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
