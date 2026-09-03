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

const MAX_SENTENCE_CHARS = 180;
const MAX_AND_JOINS = 2;

export type LintProseDensityArgs = {
  readonly filePath: string;
  readonly content: string;
};

export function lintProseDensity(args: LintProseDensityArgs): DensityFinding[] {
  return lintProseDensitySpans(args).map((findingSpan) => {
    const { endLine: _endLine, ...finding } = findingSpan;
    return finding;
  });
}

export function lintProseDensitySpans(
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
  inspectMarkdownNode(inspectArgs);

  return findings;
}

type InspectMarkdownNodeArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly insideBlockquote: boolean;
  readonly node: Nodes;
};

function inspectMarkdownNode(args: InspectMarkdownNodeArgs): void {
  if (args.node.type === 'paragraph' || args.node.type === 'tableCell') {
    if (
      args.node.type === 'paragraph' &&
      args.insideBlockquote &&
      hasQuotedOutputLabel(args.node)
    ) {
      return;
    }
    if (args.node.type === 'tableCell' && isIndexPointerCell(args.node)) return;
    const proseBlockArgs: InspectProseBlockArgs = {
      filePath: args.filePath,
      findings: args.findings,
      proseBlock: args.node,
    };
    inspectProseBlock(proseBlockArgs);
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
    inspectMarkdownNode(childArgs);
  }
}

function hasQuotedOutputLabel(paragraph: Paragraph): boolean {
  const text = markdownText(paragraph).replace(/\s+/gu, ' ').trim();
  return /^(?:command output|log (?:excerpt|output)|stderr|stdout)\s*:/iu.test(
    text,
  );
}

function isIndexPointerCell(tableCell: TableCell): boolean {
  if (tableCell.position?.start.line !== tableCell.position?.end.line) {
    return false;
  }
  const hasPointer = tableCell.children.some(
    (child) => child.type === 'link' || child.type === 'linkReference',
  );
  if (!hasPointer) return false;
  const outsidePointerText = tableCell.children
    .filter((child) => child.type !== 'link' && child.type !== 'linkReference')
    .map(markdownText)
    .join('')
    .trim();
  return outsidePointerText.length === 0;
}

type InspectProseBlockArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly proseBlock: Paragraph | TableCell;
};

function inspectProseBlock(args: InspectProseBlockArgs): void {
  const text = markdownText(args.proseBlock).replace(/\s+/gu, ' ').trim();
  if (text.length === 0) return;
  const [line = 1] = [args.proseBlock.position?.start.line];
  for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
    const sentenceArgs: AddSentenceFindingsArgs = {
      ...args,
      line,
      sentence,
    };
    addSentenceFindings(sentenceArgs);
  }
}

type AddSentenceFindingsArgs = InspectProseBlockArgs & {
  readonly line: number;
  readonly sentence: string;
};

function addSentenceFindings(args: AddSentenceFindingsArgs): void {
  const [endLine = args.line] = [args.proseBlock.position?.end.line];
  const findingBase = {
    file: args.filePath,
    line: args.line,
    endLine,
    excerpt: args.sentence.slice(0, 120),
  };
  if (args.sentence.length > MAX_SENTENCE_CHARS) {
    const lengthFinding: DensityFindingSpan = {
      ...findingBase,
      reason: `sentence longer than ${MAX_SENTENCE_CHARS} characters`,
    };
    args.findings.push(lengthFinding);
  }
  const [andJoins = 0] = [args.sentence.match(/\sand\s/giu)?.length];
  if (andJoins > MAX_AND_JOINS && args.sentence.length > 120) {
    const joinsFinding: DensityFindingSpan = {
      ...findingBase,
      reason: 'many "and" joins in a long sentence',
    };
    args.findings.push(joinsFinding);
  }
}

function markdownText(node: Nodes): string {
  if (node.type === 'image' || node.type === 'imageReference') return '';
  if (node.type === 'break') return ' ';
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (!('children' in node)) return '';
  return node.children.map(markdownText).join('');
}
