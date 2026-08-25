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
  readonly insideNonRenderedHtmlContainer: boolean;
  readonly node: RootContent;
};

type HtmlContainerDepth = {
  readonly all: number;
  readonly nonRendered: number;
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
  RawText = 'raw-text',
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

type FindRawHtmlCloseArgs = {
  readonly name: string;
  readonly start: number;
  readonly value: string;
};

type HtmlTokenVisibilityArgs = {
  readonly nonRenderedContainers: string[];
  readonly tokens: readonly HtmlToken[];
};

type VisibleSemanticChildrenInspection = {
  readonly children: readonly Nodes[];
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
  const normalizedContent = normalizeBrowserCommentTerminators(
    document.content,
  );
  const root = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(normalizedContent);
  return { ...document, root };
}

function normalizeBrowserCommentTerminators(value: string): string {
  let cursor = 0;
  let normalized = '';
  while (cursor < value.length) {
    const commentStart = value.indexOf('<!--', cursor);
    if (commentStart < 0) return normalized + value.slice(cursor);
    normalized += value.slice(cursor, commentStart);
    const standardEnd = value.indexOf('-->', commentStart + 4);
    const browserEnd = value.indexOf('--!>', commentStart + 4);
    if (standardEnd >= 0 && (browserEnd < 0 || standardEnd < browserEnd)) {
      const standardTokenEnd = standardEnd + 3;
      normalized += value.slice(commentStart, standardTokenEnd);
      cursor = standardTokenEnd;
      continue;
    }
    if (browserEnd < 0) {
      normalized += value.slice(commentStart);
      return normalized;
    }
    normalized += `${value.slice(commentStart, browserEnd)}--> `;
    cursor = browserEnd + 4;
  }
  return normalized;
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
  if (semanticNode.insideNonRenderedHtmlContainer) return false;
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
    return hasVisibleSemanticText(node.value);
  }
  if ('children' in node) {
    const childInspection: VisibleSemanticChildrenInspection = {
      children: node.children,
    };
    return childrenHaveVisibleSemanticContent(childInspection);
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
  return node.type === 'html' && isCommentOnlyHtmlValue(node.value);
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
    const depth = containerDepths[index] ?? false;
    const semanticNode: SemanticRootNode = {
      insideHtmlContainer: depth !== false && depth.all > 0,
      insideNonRenderedHtmlContainer: depth !== false && depth.nonRendered > 0,
      node,
    };
    nodes.push(semanticNode);
  }
  return nodes;
}

function htmlContainerDepths(
  children: readonly RootContent[],
): HtmlContainerDepth[] {
  const depths = children.map(() => ({ all: 0, nonRendered: 0 }));
  const starts: HtmlContainerStart[] = [];
  for (let nodeIndex = 0; nodeIndex < children.length; nodeIndex += 1) {
    const node = children[nodeIndex];
    if (node?.type !== 'html') continue;
    for (const tag of htmlTags(node.value)) {
      const activeStart = starts.at(-1) ?? false;
      if (
        activeStart !== false &&
        isRawTextHtmlContainer(activeStart.name) &&
        (!tag.closing || tag.name !== activeStart.name)
      ) {
        continue;
      }
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
        const depth = depths[index] ?? false;
        if (depth === false) continue;
        depths[index] = {
          all: depth.all + 1,
          nonRendered:
            depth.nonRendered +
            (isNonRenderedHtmlContainer(start.name) ? 1 : 0),
        };
      }
      starts.splice(startIndex);
    }
  }
  for (const start of starts) {
    for (let index = start.nodeIndex + 1; index < children.length; index += 1) {
      const depth = depths[index] ?? false;
      if (depth === false) continue;
      depths[index] = {
        all: depth.all + 1,
        nonRendered:
          depth.nonRendered + (isNonRenderedHtmlContainer(start.name) ? 1 : 0),
      };
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
  const visibilityArgs: HtmlTokenVisibilityArgs = {
    nonRenderedContainers: [],
    tokens: htmlTokens(value),
  };
  return htmlTokensHaveVisibleContent(visibilityArgs);
}

function childrenHaveVisibleSemanticContent(
  inspection: VisibleSemanticChildrenInspection,
): boolean {
  const nonRenderedContainers: string[] = [];
  for (const child of inspection.children) {
    if (child.type === 'html') {
      const visibilityArgs: HtmlTokenVisibilityArgs = {
        nonRenderedContainers,
        tokens: htmlTokens(child.value),
      };
      if (htmlTokensHaveVisibleContent(visibilityArgs)) return true;
      continue;
    }
    if (nonRenderedContainers.length > 0) continue;
    const childInspection: VisibleSemanticContentInspection = { node: child };
    if (hasVisibleSemanticContent(childInspection)) return true;
  }
  return false;
}

function htmlTokensHaveVisibleContent(args: HtmlTokenVisibilityArgs): boolean {
  for (const token of args.tokens) {
    const activeName = args.nonRenderedContainers.at(-1) ?? false;
    if (activeName !== false) {
      if (token.kind !== HtmlTokenKind.Tag) continue;
      const activeTag = htmlTags(token.value)[0] ?? false;
      if (
        activeTag !== false &&
        activeTag.closing &&
        activeTag.name === activeName
      ) {
        args.nonRenderedContainers.pop();
      } else if (
        activeTag !== false &&
        !activeTag.closing &&
        isNonRenderedHtmlContainer(activeTag.name)
      ) {
        args.nonRenderedContainers.push(activeTag.name);
      }
      continue;
    }
    if (token.kind === HtmlTokenKind.Text) {
      const decodedText = decodeHtmlText(token.value);
      if (hasVisibleSemanticText(decodedText)) return true;
    }
    if (token.kind !== HtmlTokenKind.Tag) continue;
    const tag = htmlTags(token.value)[0] ?? false;
    if (tag === false) {
      if (hasVisibleUnparsedHtmlMarkup(token.value)) return true;
      continue;
    }
    if (!tag.closing && isNonRenderedHtmlContainer(tag.name)) {
      args.nonRenderedContainers.push(tag.name);
      continue;
    }
    if (!tag.closing && isVisibleHtmlElement(tag.name)) return true;
  }
  return false;
}

function htmlTokens(value: string): readonly HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    if (value.startsWith('<!--', cursor)) {
      const standardEnd = value.indexOf('-->', cursor + 4);
      const browserEnd = value.indexOf('--!>', cursor + 4);
      const commentEnd =
        standardEnd < 0
          ? browserEnd
          : browserEnd < 0
            ? standardEnd
            : Math.min(standardEnd, browserEnd);
      const terminatorLength = commentEnd === browserEnd ? 4 : 3;
      const tokenEnd =
        commentEnd < 0 ? value.length : commentEnd + terminatorLength;
      const token: HtmlToken = {
        kind: HtmlTokenKind.Comment,
        value: value.slice(cursor, tokenEnd),
      };
      tokens.push(token);
      cursor = tokenEnd;
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
        const rawName = rawHtmlContainerName(token.value);
        if (rawName !== false) {
          const closeArgs: FindRawHtmlCloseArgs = {
            name: rawName,
            start: cursor,
            value,
          };
          const closeStart = findRawHtmlClose(closeArgs);
          const rawEnd = closeStart < 0 ? value.length : closeStart;
          if (rawEnd > cursor) {
            const rawToken: HtmlToken = {
              kind: HtmlTokenKind.RawText,
              value: value.slice(cursor, rawEnd),
            };
            tokens.push(rawToken);
          }
          cursor = rawEnd;
        }
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

function rawHtmlContainerName(token: string): string | false {
  if (/\/\s*>$/u.test(token)) return false;
  const parts = /^<\s*([A-Za-z][A-Za-z0-9:-]*)/u.exec(token);
  const name = parts?.[1];
  if (typeof name !== 'string') return false;
  const normalizedName = name.toLowerCase();
  return isRawTextHtmlContainer(normalizedName) ? normalizedName : false;
}

function findRawHtmlClose(args: FindRawHtmlCloseArgs): number {
  const lowerValue = args.value.toLowerCase();
  const prefix = `</${args.name}`;
  let cursor = args.start;
  while (cursor < lowerValue.length) {
    const closeStart = lowerValue.indexOf(prefix, cursor);
    if (closeStart < 0) return -1;
    const boundary = lowerValue[closeStart + prefix.length] ?? '';
    if (boundary === '>' || /\s/u.test(boundary)) return closeStart;
    cursor = closeStart + prefix.length;
  }
  return -1;
}

function isNonRenderedHtmlContainer(name: string): boolean {
  return ['script', 'style', 'template'].includes(name);
}

function isRawTextHtmlContainer(name: string): boolean {
  return ['script', 'style'].includes(name);
}

function decodeHtmlText(value: string): string {
  const root = unified().use(remarkParse).parse(value);
  return root.children.map(nodeText).join('');
}

function hasVisibleSemanticText(value: string): boolean {
  return value.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, '').length > 0;
}

function hasVisibleUnparsedHtmlMarkup(value: string): boolean {
  if (/^<!doctype(?:\s|>)/iu.test(value)) return false;
  if (/^<\?[\s\S]*\?>$/u.test(value)) return false;
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/u.exec(value);
  const cdataText = cdata?.[1] ?? false;
  if (cdataText !== false) return hasVisibleSemanticText(cdataText);
  return !/^<!/u.test(value);
}

function isCommentOnlyHtmlValue(value: string): boolean {
  return htmlTokens(value).every(
    (token) =>
      token.kind === HtmlTokenKind.Comment ||
      (token.kind === HtmlTokenKind.Text &&
        !hasVisibleSemanticText(decodeHtmlText(token.value))),
  );
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
