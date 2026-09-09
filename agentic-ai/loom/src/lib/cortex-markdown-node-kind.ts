import type { Nodes } from 'mdast';

export enum MarkdownArticlePresence {
  Present = 'present',
  Absent = 'absent',
}

export enum MarkdownArticleContentRole {
  Hidden = 'hidden',
  Intrinsic = 'intrinsic',
  Example = 'example',
  Inspect = 'inspect',
}

export enum MarkdownProcedureTraversal {
  Excluded = 'excluded',
  Inspect = 'inspect',
}

/** Interprets mdast's existing discriminator without receiving an AST node. */
export class CortexMarkdownNodeKind {
  constructor(private readonly kind: Nodes['type']) {}

  transparency(): MarkdownArticlePresence {
    return this.kind === 'definition' || this.kind === 'footnoteDefinition'
      ? MarkdownArticlePresence.Present
      : MarkdownArticlePresence.Absent;
  }

  procedureTraversal(): MarkdownProcedureTraversal {
    switch (this.kind) {
      case 'blockquote':
      case 'code':
      case 'footnoteDefinition':
      case 'html':
        return MarkdownProcedureTraversal.Excluded;
      default:
        return MarkdownProcedureTraversal.Inspect;
    }
  }

  contentRole(): MarkdownArticleContentRole {
    switch (this.kind) {
      case 'definition':
      case 'footnoteDefinition':
      case 'heading':
      case 'html':
      case 'thematicBreak':
      case 'break':
        return MarkdownArticleContentRole.Hidden;
      case 'image':
      case 'imageReference':
      case 'footnoteReference':
        return MarkdownArticleContentRole.Intrinsic;
      case 'blockquote':
      case 'code':
        return MarkdownArticleContentRole.Example;
      default:
        return MarkdownArticleContentRole.Inspect;
    }
  }

  proseRole(): MarkdownArticleContentRole {
    switch (this.kind) {
      case 'image':
      case 'imageReference':
      case 'footnoteReference':
        return MarkdownArticleContentRole.Hidden;
      default:
        return this.contentRole();
    }
  }
}
