import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Heading, Nodes, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { CortexDocumentSource } from './cortex-document-structure.ts';

export enum CortexArticleFindingCode {
  InvalidMigrationLedger = 'invalid-article-migration-ledger',
  EmptyArticle = 'empty-article',
  DenseArticle = 'dense-article',
  UnorderedProcedure = 'unordered-procedure',
}

export type CortexArticleFinding = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type AuditCortexArticleStructureArgs = {
  readonly documents: readonly CortexDocumentSource[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerPath: string;
  readonly repoRoot: string;
};

type ParsedArticleDocument = CortexDocumentSource & {
  readonly root: Root;
};

type AddFindingArgs = {
  readonly findings: CortexArticleFinding[];
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

type ReadMigrationExemptionsArgs = {
  readonly catalog: ReadonlySet<string>;
  readonly findings: CortexArticleFinding[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerPath: string;
  readonly repoRoot: string;
};

type AuditDocumentArgs = {
  readonly document: ParsedArticleDocument;
  readonly findings: CortexArticleFinding[];
};

type AuditArticleArgs = AuditDocumentArgs & {
  readonly heading: Heading;
  readonly sectionNodes: readonly SemanticRootNode[];
};

type SemanticRootNode = {
  readonly insideHtmlContainer: boolean;
  readonly node: RootContent;
};

type HtmlContainerStart = {
  readonly name: string;
  readonly nodeIndex: number;
};

type HtmlTag = {
  readonly closing: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
};

enum HtmlTokenKind {
  Comment = 'comment',
  Tag = 'tag',
  Text = 'text',
}

type HtmlToken = {
  readonly kind: HtmlTokenKind;
  readonly value: string;
};

type FindHtmlTagEndArgs = {
  readonly start: number;
  readonly value: string;
};

type LastHtmlContainerStartIndexArgs = {
  readonly name: string;
  readonly starts: readonly HtmlContainerStart[];
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;

export function auditCortexArticleStructure(
  args: AuditCortexArticleStructureArgs,
): CortexArticleFinding[] {
  const findings: CortexArticleFinding[] = [];
  const documents = args.documents.map(parseDocument);
  const catalog = new Set(documents.map((document) => document.relativePath));
  const exemptionArgs: ReadMigrationExemptionsArgs = {
    catalog,
    findings,
    migrationBaselineEntries: args.migrationBaselineEntries,
    migrationLedgerPath: args.migrationLedgerPath,
    repoRoot: args.repoRoot,
  };
  const exemptions = readMigrationExemptions(exemptionArgs);

  for (const document of documents) {
    if (exemptions.has(document.relativePath)) {
      continue;
    }
    const documentArgs: AuditDocumentArgs = { document, findings };
    auditDocument(documentArgs);
  }

  return findings;
}

function parseDocument(document: CortexDocumentSource): ParsedArticleDocument {
  const root = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(document.content);
  return { ...document, root };
}

function readMigrationExemptions(
  args: ReadMigrationExemptionsArgs,
): ReadonlySet<string> {
  let content: string;
  try {
    content = readFileSync(args.migrationLedgerPath, 'utf8');
  } catch {
    return new Set<string>();
  }

  const exemptions = new Set<string>();
  const baseline =
    args.migrationBaselineEntries === false
      ? false
      : new Set(args.migrationBaselineEntries);
  const ledgerFile = path.relative(args.repoRoot, args.migrationLedgerPath);
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const entry = (lines[index] ?? '').trim();
    if (entry.length === 0 || entry.startsWith('#')) {
      continue;
    }
    const invalidMessageArgs: InvalidLedgerMessageArgs = {
      baseline,
      catalog: args.catalog,
      entry,
      exemptions,
    };
    const message = invalidLedgerMessage(invalidMessageArgs);
    if (message !== false) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexArticleFindingCode.InvalidMigrationLedger,
        file: ledgerFile,
        line: index + 1,
        message,
      };
      addFinding(findingArgs);
      continue;
    }
    exemptions.add(entry);
  }

  return exemptions;
}

type InvalidLedgerMessageArgs = {
  readonly baseline: ReadonlySet<string> | false;
  readonly catalog: ReadonlySet<string>;
  readonly entry: string;
  readonly exemptions: ReadonlySet<string>;
};

function invalidLedgerMessage(args: InvalidLedgerMessageArgs): string | false {
  if (args.exemptions.has(args.entry)) {
    return `Duplicate article-structure migration exemption: ${args.entry}`;
  }
  if (!args.catalog.has(args.entry)) {
    return `Article-structure exemption is not a Cortex Markdown file: ${args.entry}`;
  }
  if (args.baseline !== false && !args.baseline.has(args.entry)) {
    return `Article-structure exemption was added after the baseline: ${args.entry}`;
  }
  return false;
}

function auditDocument(args: AuditDocumentArgs): void {
  const children = semanticRootNodes(args.document.root.children);
  for (let index = 0; index < children.length; index += 1) {
    const semanticNode = children[index] ?? false;
    const node = semanticNode === false ? false : semanticNode.node;
    if (
      node === false ||
      semanticNode === false ||
      semanticNode.insideHtmlContainer ||
      node.type !== 'heading' ||
      (node.depth !== 2 && node.depth !== 3)
    ) {
      continue;
    }
    const sectionNodeArgs: OwnedSectionNodesArgs = {
      children,
      headingIndex: index,
    };
    const sectionNodes = ownedSectionNodes(sectionNodeArgs);
    const articleArgs: AuditArticleArgs = {
      document: args.document,
      findings: args.findings,
      heading: node,
      sectionNodes,
    };
    auditArticle(articleArgs);
  }
}

type OwnedSectionNodesArgs = {
  readonly children: readonly SemanticRootNode[];
  readonly headingIndex: number;
};

function ownedSectionNodes(
  args: OwnedSectionNodesArgs,
): readonly SemanticRootNode[] {
  const headingNode = args.children[args.headingIndex] ?? false;
  const heading = headingNode === false ? false : headingNode.node;
  if (
    headingNode === false ||
    headingNode.insideHtmlContainer ||
    heading === false ||
    heading.type !== 'heading'
  ) {
    return [];
  }
  let end = args.children.length;
  for (
    let index = args.headingIndex + 1;
    index < args.children.length;
    index += 1
  ) {
    const semanticNode = args.children[index];
    const node = semanticNode?.node;
    if (
      semanticNode?.insideHtmlContainer === false &&
      node?.type === 'heading' &&
      node.depth <= heading.depth
    ) {
      end = index;
      break;
    }
  }
  return args.children.slice(args.headingIndex + 1, end);
}

function auditArticle(args: AuditArticleArgs): void {
  if (!args.sectionNodes.some(isVisibleArticleNode)) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexArticleFindingCode.EmptyArticle,
      file: args.document.relativePath,
      line: nodeLine(args.heading),
      message: `Article #${nodeText(args.heading)} has no body content.`,
    };
    addFinding(findingArgs);
    return;
  }

  auditConsecutiveParagraphs(args);
  auditProcedure(args);
}

function isVisibleArticleNode(semanticNode: SemanticRootNode): boolean {
  const node = semanticNode.node;
  if (node.type === 'heading' || isTransparentArticleNode(node)) return false;
  const inspection: VisibleSemanticContentInspection = { node };
  return hasVisibleSemanticContent(inspection);
}

type VisibleSemanticContentInspection = {
  readonly node: Nodes;
};

function hasVisibleSemanticContent(
  inspection: VisibleSemanticContentInspection,
): boolean {
  const node = inspection.node;
  if (node.type === 'definition' || node.type === 'thematicBreak') return false;
  if (node.type === 'html') return !isInvisibleHtml(node);
  if (
    node.type === 'code' ||
    node.type === 'inlineCode' ||
    node.type === 'text'
  ) {
    return node.value.trim().length > 0;
  }
  if ('children' in node) {
    return node.children.some((child) => {
      const childInspection: VisibleSemanticContentInspection = { node: child };
      return hasVisibleSemanticContent(childInspection);
    });
  }
  return node.type !== 'break';
}

function auditConsecutiveParagraphs(args: AuditArticleArgs): void {
  let consecutive = 0;
  for (const semanticNode of args.sectionNodes) {
    const node = semanticNode.node;
    if (semanticNode.insideHtmlContainer) {
      consecutive = 0;
      continue;
    }
    if (node.type === 'heading') {
      break;
    }
    if (isTransparentDensityNode(node)) {
      continue;
    }
    if (node.type !== 'paragraph' || !isVisibleArticleNode(semanticNode)) {
      consecutive = 0;
      continue;
    }
    consecutive += 1;
    if (consecutive === MAX_CONSECUTIVE_PARAGRAPHS + 1) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexArticleFindingCode.DenseArticle,
        file: args.document.relativePath,
        line: nodeLine(node),
        message: `Article #${nodeText(args.heading)} has more than ${MAX_CONSECUTIVE_PARAGRAPHS} consecutive prose blocks without visible structure.`,
      };
      addFinding(findingArgs);
    }
  }
}

function isTransparentArticleNode(node: RootContent): boolean {
  return node.type === 'definition' || isInvisibleHtml(node);
}

function isTransparentDensityNode(node: RootContent): boolean {
  return node.type === 'definition' || isCommentOnlyHtml(node);
}

function isCommentOnlyHtml(node: RootContent): boolean {
  return (
    node.type === 'html' &&
    /^\s*(?:<!--(?:(?!-->)[\s\S])*-->\s*)+$/u.test(node.value)
  );
}

function isInvisibleHtml(node: RootContent): boolean {
  return node.type === 'html' && !hasVisibleHtmlContent(node.value);
}

function auditProcedure(args: AuditArticleArgs): void {
  if (!PROCEDURE_HEADING.test(nodeText(args.heading))) {
    return;
  }
  const hasOrderedList = args.sectionNodes.some((semanticNode) => {
    if (semanticNode.insideHtmlContainer) return false;
    const node = semanticNode.node;
    if (node.type !== 'list' || node.ordered !== true) return false;
    const inspection: VisibleSemanticContentInspection = { node };
    return hasVisibleSemanticContent(inspection);
  });
  if (hasOrderedList) {
    return;
  }
  const findingArgs: AddFindingArgs = {
    findings: args.findings,
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: args.document.relativePath,
    line: nodeLine(args.heading),
    message: `Procedure-like article #${nodeText(args.heading)} must expose its action sequence as an ordered list.`,
  };
  addFinding(findingArgs);
}

function semanticRootNodes(
  children: readonly RootContent[],
): readonly SemanticRootNode[] {
  const containerDepths = htmlContainerDepths(children);
  const nodes: SemanticRootNode[] = [];
  for (const [index, node] of children.entries()) {
    const semanticNode: SemanticRootNode = {
      insideHtmlContainer: (containerDepths[index] ?? 0) > 0,
      node,
    };
    nodes.push(semanticNode);
  }
  return nodes;
}

function htmlContainerDepths(children: readonly RootContent[]): number[] {
  const depths = children.map(() => 0);
  const starts: HtmlContainerStart[] = [];
  for (let nodeIndex = 0; nodeIndex < children.length; nodeIndex += 1) {
    const node = children[nodeIndex];
    if (node?.type !== 'html') continue;
    for (const tag of htmlTags(node.value)) {
      if (!tag.closing && !tag.selfClosing && !isVoidHtmlTag(tag.name)) {
        const start: HtmlContainerStart = { name: tag.name, nodeIndex };
        starts.push(start);
        continue;
      }
      if (!tag.closing) continue;
      const startArgs: LastHtmlContainerStartIndexArgs = {
        name: tag.name,
        starts,
      };
      const startIndex = lastHtmlContainerStartIndex(startArgs);
      if (startIndex < 0) continue;
      const start = starts[startIndex] ?? false;
      if (start === false) continue;
      for (let index = start.nodeIndex + 1; index < nodeIndex; index += 1) {
        depths[index] = (depths[index] ?? 0) + 1;
      }
      starts.splice(startIndex);
    }
  }
  return depths;
}

function lastHtmlContainerStartIndex(
  args: LastHtmlContainerStartIndexArgs,
): number {
  for (let index = args.starts.length - 1; index >= 0; index -= 1) {
    if (args.starts[index]?.name === args.name) return index;
  }
  return -1;
}

function htmlTags(value: string): readonly HtmlTag[] {
  const tags: HtmlTag[] = [];
  for (const token of htmlTokens(value)) {
    if (token.kind !== HtmlTokenKind.Tag) continue;
    const parts = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/u.exec(token.value);
    const name = parts?.[2];
    if (typeof name !== 'string') continue;
    const tag: HtmlTag = {
      closing: parts?.[1] === '/',
      name: name.toLowerCase(),
      selfClosing: /\/\s*>$/u.test(token.value),
    };
    tags.push(tag);
  }
  return tags;
}

function hasVisibleHtmlContent(value: string): boolean {
  for (const token of htmlTokens(value)) {
    if (token.kind === HtmlTokenKind.Text && token.value.trim().length > 0) {
      return true;
    }
    if (token.kind !== HtmlTokenKind.Tag) continue;
    const tag = htmlTags(token.value)[0] ?? false;
    if (tag === false) return true;
    if (!tag.closing && isVisibleHtmlElement(tag.name)) return true;
  }
  return false;
}

function htmlTokens(value: string): readonly HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    if (value.startsWith('<!--', cursor)) {
      const commentEnd = value.indexOf('-->', cursor + 4);
      if (commentEnd < 0) {
        const token: HtmlToken = {
          kind: HtmlTokenKind.Text,
          value: value.slice(cursor),
        };
        tokens.push(token);
        break;
      }
      const token: HtmlToken = {
        kind: HtmlTokenKind.Comment,
        value: value.slice(cursor, commentEnd + 3),
      };
      tokens.push(token);
      cursor = commentEnd + 3;
      continue;
    }
    if (value[cursor] === '<') {
      const endArgs: FindHtmlTagEndArgs = { start: cursor, value };
      const tagEnd = findHtmlTagEnd(endArgs);
      if (tagEnd >= 0) {
        const token: HtmlToken = {
          kind: HtmlTokenKind.Tag,
          value: value.slice(cursor, tagEnd + 1),
        };
        tokens.push(token);
        cursor = tagEnd + 1;
        continue;
      }
    }
    const nextTag = value.indexOf('<', cursor + 1);
    const textEnd = nextTag < 0 ? value.length : nextTag;
    const token: HtmlToken = {
      kind: HtmlTokenKind.Text,
      value: value.slice(cursor, textEnd),
    };
    tokens.push(token);
    cursor = textEnd;
  }
  return tokens;
}

function findHtmlTagEnd(args: FindHtmlTagEndArgs): number {
  let quote = '';
  for (let index = args.start + 1; index < args.value.length; index += 1) {
    const character = args.value[index] ?? '';
    if (quote.length > 0) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return -1;
}

function isVisibleHtmlElement(name: string): boolean {
  return [
    'audio',
    'canvas',
    'embed',
    'iframe',
    'img',
    'input',
    'meter',
    'object',
    'progress',
    'svg',
    'video',
  ].includes(name);
}

function isVoidHtmlTag(name: string): boolean {
  return [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ].includes(name);
}

function nodeText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }
  if (!('children' in node)) {
    return '';
  }
  return node.children.map((child) => nodeText(child as RootContent)).join('');
}

function nodeLine(node: RootContent): number {
  return node.position?.start.line ?? 1;
}

function addFinding(args: AddFindingArgs): void {
  const finding: CortexArticleFinding = {
    code: args.code,
    file: args.file,
    line: args.line,
    message: args.message,
  };
  args.findings.push(finding);
}
