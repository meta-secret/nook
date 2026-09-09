import type { Nodes, Paragraph, TableCell } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type DensityFinding = {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly excerpt: string;
};

export type DensityFindingSpan = DensityFinding & {
  readonly endLine: number;
};

/** Owns the cortex prose density registry and its capability transitions. */
export class CortexProseDensity {
  private constructor() {}
  private static readonly MAX_AND_JOINS = 2;

  static lintProseDensity(args: LintProseDensityArgs): DensityFinding[] {
    return CortexProseDensity.lintProseDensitySpans(args).map((findingSpan) => {
      const { endLine: _endLine, ...finding } = findingSpan;
      return finding;
    });
  }

  static lintProseDensitySpans(
    args: LintProseDensityArgs,
  ): DensityFindingSpan[] {
    const { filePath, content } = args;
    const findings: DensityFindingSpan[] = [];
    const root = unified().use(remarkParse).use(remarkGfm).parse(content);
    const inspectArgs: InspectMarkdownNodeArgs = {
      filePath,
      findings,
      insideBlockquote: false,
      node: root,
    };
    CortexProseDensity.inspectMarkdownNode(inspectArgs);

    return findings;
  }

  private static inspectMarkdownNode(args: InspectMarkdownNodeArgs): void {
    if (args.node.type === 'paragraph' || args.node.type === 'tableCell') {
      if (
        args.node.type === 'paragraph' &&
        args.insideBlockquote &&
        CortexProseDensity.hasQuotedOutputLabel(args.node)
      ) {
        return;
      }
      if (
        args.node.type === 'tableCell' &&
        CortexProseDensity.isIndexPointerCell(args.node)
      )
        return;
      const proseBlockArgs: InspectProseBlockArgs = {
        filePath: args.filePath,
        findings: args.findings,
        proseBlock: args.node,
      };
      CortexProseDensity.inspectProseBlock(proseBlockArgs);
      return;
    }
    if (!('children' in args.node)) return;
    for (const child of args.node.children) {
      const childArgs: InspectMarkdownNodeArgs = {
        ...args,
        insideBlockquote:
          args.insideBlockquote || args.node.type === 'blockquote',
        node: child,
      };
      CortexProseDensity.inspectMarkdownNode(childArgs);
    }
  }

  private static hasQuotedOutputLabel(paragraph: Paragraph): boolean {
    const text = CortexProseDensity.markdownText(paragraph)
      .replace(/\s+/gu, ' ')
      .trim();
    return /^(?:command output|log (?:excerpt|output)|stderr|stdout)\s*:/iu.test(
      text,
    );
  }

  private static isIndexPointerCell(tableCell: TableCell): boolean {
    if (tableCell.position?.start.line !== tableCell.position?.end.line) {
      return false;
    }
    const hasPointer = tableCell.children.some(
      (child) => child.type === 'link' || child.type === 'linkReference',
    );
    if (!hasPointer) return false;
    const outsidePointerText = tableCell.children
      .filter(
        (child) => child.type !== 'link' && child.type !== 'linkReference',
      )
      .map(CortexProseDensity.markdownText)
      .join('')
      .trim();
    return outsidePointerText.length === 0;
  }

  private static inspectProseBlock(args: InspectProseBlockArgs): void {
    const text = CortexProseDensity.markdownText(args.proseBlock)
      .replace(/\s+/gu, ' ')
      .trim();
    if (text.length === 0) return;
    const [line = 1] = [args.proseBlock.position?.start.line];
    for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
      const sentenceArgs: AddSentenceFindingsArgs = {
        ...args,
        line,
        sentence,
      };
      CortexProseDensity.addSentenceFindings(sentenceArgs);
    }
  }

  private static addSentenceFindings(args: AddSentenceFindingsArgs): void {
    const [endLine = args.line] = [args.proseBlock.position?.end.line];
    const findingBase = {
      file: args.filePath,
      line: args.line,
      endLine,
      excerpt: args.sentence.slice(0, 120),
    };
    const [andJoins = 0] = [args.sentence.match(/\sand\s/giu)?.length];
    if (
      andJoins > CortexProseDensity.MAX_AND_JOINS &&
      args.sentence.length > 120
    ) {
      const joinsFinding: DensityFindingSpan = {
        ...findingBase,
        reason: 'many "and" joins in a long sentence',
      };
      args.findings.push(joinsFinding);
    }
  }

  private static markdownText(node: Nodes): string {
    if (node.type === 'image' || node.type === 'imageReference') return '';
    if (node.type === 'break') return ' ';
    if ('value' in node && typeof node.value === 'string') return node.value;
    if (!('children' in node)) return '';
    return node.children.map(CortexProseDensity.markdownText).join('');
  }
}

export type LintProseDensityArgs = {
  readonly filePath: string;
  readonly content: string;
};

type InspectMarkdownNodeArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly insideBlockquote: boolean;
  readonly node: Nodes;
};

type InspectProseBlockArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly proseBlock: Paragraph | TableCell;
};

type AddSentenceFindingsArgs = InspectProseBlockArgs & {
  readonly line: number;
  readonly sentence: string;
};
