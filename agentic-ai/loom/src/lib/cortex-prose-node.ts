import type { Nodes } from 'mdast';

export enum CortexProseContext {
  Body = 'body',
  Quotation = 'quotation',
}

export enum CortexProseInspection {
  Inspect = 'inspect',
  Descend = 'descend',
  Excluded = 'excluded',
}

enum CortexProseTextRole {
  Omit = 'omit',
  Space = 'space',
  Content = 'content',
}

enum CortexProsePointerRole {
  Pointer = 'pointer',
  Content = 'content',
}

enum CortexProseExemption {
  Exempt = 'exempt',
  Included = 'included',
}

class CortexProseNodeKind {
  constructor(private readonly kind: Nodes['type']) {}

  textRole(): CortexProseTextRole {
    switch (this.kind) {
      case 'image':
      case 'imageReference':
        return CortexProseTextRole.Omit;
      case 'break':
        return CortexProseTextRole.Space;
      default:
        return CortexProseTextRole.Content;
    }
  }

  pointerRole(): CortexProsePointerRole {
    return this.kind === 'link' || this.kind === 'linkReference'
      ? CortexProsePointerRole.Pointer
      : CortexProsePointerRole.Content;
  }

  childContext(context: CortexProseContext): CortexProseContext {
    return this.kind === 'blockquote' ? CortexProseContext.Quotation : context;
  }
}

/** Owns the prose interpretation of one AST node and its child content. */
export class CortexProseNode {
  private readonly kind: CortexProseNodeKind;

  constructor(private readonly node: Nodes) {
    this.kind = new CortexProseNodeKind(node.type);
  }

  inspection(context: CortexProseContext): CortexProseInspection {
    switch (this.node.type) {
      case 'paragraph':
        return context === CortexProseContext.Quotation &&
          this.quotedOutputExemption() === CortexProseExemption.Exempt
          ? CortexProseInspection.Excluded
          : CortexProseInspection.Inspect;
      case 'tableCell':
        return this.indexPointerExemption() === CortexProseExemption.Exempt
          ? CortexProseInspection.Excluded
          : CortexProseInspection.Inspect;
      default:
        return CortexProseInspection.Descend;
    }
  }

  childContext(context: CortexProseContext): CortexProseContext {
    return this.kind.childContext(context);
  }

  text(): string {
    switch (this.kind.textRole()) {
      case CortexProseTextRole.Omit:
        return '';
      case CortexProseTextRole.Space:
        return ' ';
      case CortexProseTextRole.Content:
        if ('value' in this.node && typeof this.node.value === 'string')
          return this.node.value;
        return this.children()
          .map((child) => child.text())
          .join('');
    }
  }

  children(): readonly CortexProseNode[] {
    return 'children' in this.node
      ? this.node.children.map((child) => new CortexProseNode(child))
      : [];
  }

  sourceSpan(): CortexProseSourceSpan {
    const line = this.node.position?.start.line ?? 1;
    return { line, endLine: this.node.position?.end.line ?? line };
  }

  private quotedOutputExemption(): CortexProseExemption {
    const text = this.text().replace(/\s+/gu, ' ').trim();
    return /^(?:command output|log (?:excerpt|output)|stderr|stdout)\s*:/iu.test(
      text,
    )
      ? CortexProseExemption.Exempt
      : CortexProseExemption.Included;
  }

  private indexPointerExemption(): CortexProseExemption {
    if (this.node.position?.start.line !== this.node.position?.end.line) {
      return CortexProseExemption.Included;
    }
    const children = this.children();
    if (
      !children.some(
        (child) => child.kind.pointerRole() === CortexProsePointerRole.Pointer,
      )
    ) {
      return CortexProseExemption.Included;
    }
    const outsidePointerText = children
      .filter(
        (child) => child.kind.pointerRole() === CortexProsePointerRole.Content,
      )
      .map((child) => child.text())
      .join('')
      .trim();
    return outsidePointerText.length === 0
      ? CortexProseExemption.Exempt
      : CortexProseExemption.Included;
  }
}

export type CortexProseSourceSpan = {
  readonly line: number;
  readonly endLine: number;
};
