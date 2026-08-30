import type { Blockquote, Nodes, Paragraph } from 'mdast';
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
const MAX_SEMICOLONS = 1;
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
    node: root,
  };
  inspectMarkdownNode(inspectArgs);

  return findings;
}

type InspectMarkdownNodeArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly node: Nodes;
};

function inspectMarkdownNode(args: InspectMarkdownNodeArgs): void {
  if (args.node.type === 'blockquote' && isQuotedOutput(args.node)) return;
  if (args.node.type === 'paragraph') {
    const paragraphArgs: InspectParagraphArgs = {
      filePath: args.filePath,
      findings: args.findings,
      paragraph: args.node,
    };
    inspectParagraph(paragraphArgs);
    return;
  }
  if (!('children' in args.node)) return;
  for (const child of args.node.children) {
    const childArgs: InspectMarkdownNodeArgs = { ...args, node: child };
    inspectMarkdownNode(childArgs);
  }
}

function isQuotedOutput(blockquote: Blockquote): boolean {
  const text = markdownText(blockquote).replace(/\s+/gu, ' ').trim();
  return /^(?:command output|log (?:excerpt|output)|stderr|stdout)\s*:/iu.test(
    text,
  );
}

type InspectParagraphArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly paragraph: Paragraph;
};

function inspectParagraph(args: InspectParagraphArgs): void {
  const text = markdownText(args.paragraph).replace(/\s+/gu, ' ').trim();
  if (text.length === 0) return;
  const line = args.paragraph.position?.start.line ?? 1;
  for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
    const sentenceArgs: AddSentenceFindingsArgs = {
      ...args,
      line,
      sentence,
    };
    addSentenceFindings(sentenceArgs);
  }
}

type AddSentenceFindingsArgs = InspectParagraphArgs & {
  readonly line: number;
  readonly sentence: string;
};

function addSentenceFindings(args: AddSentenceFindingsArgs): void {
  const endLine = args.paragraph.position?.end.line ?? args.line;
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
  const semicolons = args.sentence.match(/;/gu)?.length ?? 0;
  if (semicolons > MAX_SEMICOLONS) {
    const semicolonFinding: DensityFindingSpan = {
      ...findingBase,
      reason: 'too many semicolons in one sentence',
    };
    args.findings.push(semicolonFinding);
  }
  const andJoins = args.sentence.match(/\sand\s/giu)?.length ?? 0;
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
