import type { Blockquote, Nodes, Paragraph } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export enum GitHubAlertDensityReason {
  AndJoins = 'Use at most two "and" joins in sentences over 120 characters.',
  Semicolons = 'Use at most one semicolon per sentence.',
  SentenceLength = 'Keep sentences at 180 characters or fewer.',
}

export type GitHubAlertDensityFinding = {
  readonly endLine: number;
  readonly file: string;
  readonly line: number;
  readonly reason: GitHubAlertDensityReason;
};

export type LintGitHubAlertDensityArgs = {
  readonly content: string;
  readonly filePath: string;
};

const GITHUB_ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/u;
const GITHUB_ALERT_PREFIX =
  /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\r?\n/u;

export function lintGitHubAlertDensity(
  args: LintGitHubAlertDensityArgs,
): GitHubAlertDensityFinding[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(args.content);
  const findings: GitHubAlertDensityFinding[] = [];
  inspectNode({ ...args, findings, node: root });
  return findings;
}

type InspectNodeArgs = LintGitHubAlertDensityArgs & {
  readonly findings: GitHubAlertDensityFinding[];
  readonly node: Nodes;
};

function inspectNode(args: InspectNodeArgs): void {
  if (args.node.type === 'blockquote' && isGitHubAlert(args.node)) {
    inspectGitHubAlert({ ...args, blockquote: args.node });
    return;
  }
  if (!('children' in args.node)) return;
  for (const child of args.node.children) {
    inspectNode({ ...args, node: child });
  }
}

function isGitHubAlert(blockquote: Blockquote): boolean {
  const first = blockquote.children[0];
  if (!first || first.type !== 'paragraph') return false;
  const text = markdownText(first);
  return GITHUB_ALERT_MARKER.test(text) || GITHUB_ALERT_PREFIX.test(text);
}

type InspectGitHubAlertArgs = InspectNodeArgs & {
  readonly blockquote: Blockquote;
};

function inspectGitHubAlert(args: InspectGitHubAlertArgs): void {
  const first = args.blockquote.children[0];
  const paragraphs: Paragraph[] = [];
  collectParagraphs({ node: args.blockquote, paragraphs });
  for (const paragraph of paragraphs) {
    const rawText = markdownText(paragraph);
    const bodyText =
      paragraph === first
        ? rawText
            .replace(GITHUB_ALERT_MARKER, '')
            .replace(GITHUB_ALERT_PREFIX, '')
        : rawText;
    const text = normalizeMarkdownText(bodyText);
    if (text.length === 0) continue;
    const position = paragraph.position;
    const paragraphLine = position ? position.start.line : 1;
    const firstContainsBody =
      paragraph === first && GITHUB_ALERT_PREFIX.test(rawText);
    const line = firstContainsBody ? paragraphLine + 1 : paragraphLine;
    const endLine = position ? position.end.line : line;
    for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
      addSentenceFindings({
        endLine,
        filePath: args.filePath,
        findings: args.findings,
        line,
        sentence,
      });
    }
  }
}

type CollectParagraphsArgs = {
  readonly node: Nodes;
  readonly paragraphs: Paragraph[];
};

function collectParagraphs(args: CollectParagraphsArgs): void {
  if (args.node.type === 'paragraph') {
    args.paragraphs.push(args.node);
    return;
  }
  if (!('children' in args.node)) return;
  for (const child of args.node.children) {
    if (child.type !== 'blockquote') {
      collectParagraphs({ ...args, node: child });
    }
  }
}

type AddSentenceFindingsArgs = {
  readonly endLine: number;
  readonly filePath: string;
  readonly findings: GitHubAlertDensityFinding[];
  readonly line: number;
  readonly sentence: string;
};

function addSentenceFindings(args: AddSentenceFindingsArgs): void {
  const finding = (reason: GitHubAlertDensityReason) => ({
    endLine: args.endLine,
    file: args.filePath,
    line: args.line,
    reason,
  });
  const semicolons = args.sentence.match(/;/gu);
  if (semicolons && semicolons.length > 1) {
    args.findings.push(finding(GitHubAlertDensityReason.Semicolons));
  }
  const sentenceLength = [...args.sentence].length;
  if (sentenceLength > 180) {
    args.findings.push(finding(GitHubAlertDensityReason.SentenceLength));
  }
  const andJoins = args.sentence.match(/\sand\s/giu);
  if (sentenceLength > 120 && andJoins && andJoins.length > 2) {
    args.findings.push(finding(GitHubAlertDensityReason.AndJoins));
  }
}

function normalizeMarkdownText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function markdownText(node: Nodes): string {
  if (node.type === 'image' || node.type === 'imageReference') return '';
  if (node.type === 'break') return ' ';
  if (node.type === 'inlineCode') return '*'.repeat([...node.value].length);
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (!('children' in node)) return '';
  return node.children.map(markdownText).join('');
}
