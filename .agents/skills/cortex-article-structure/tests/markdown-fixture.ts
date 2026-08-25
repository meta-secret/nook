import type { Nodes, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  CortexArticleBlockKind,
  type CortexArticleBlock,
} from '../src/domain.ts';

export function blocksFromMarkdown(
  content: string,
): readonly CortexArticleBlock[] {
  const parser = unified().use(remarkParse).use(remarkGfm);
  const children = parser.parse(content).children;
  const containerDepths = htmlContainerDepths(children);
  const blocks: CortexArticleBlock[] = [];
  for (const [index, node] of children.entries()) {
    const depth = containerDepths[index] ?? false;
    const args: BlockFromNodeArgs = {
      insideHtmlContainer: depth !== false && depth.all > 0,
      insideNonRenderedHtmlContainer: depth !== false && depth.nonRendered > 0,
      node,
    };
    blocks.push(blockFromNode(args));
  }
  return blocks;
}

type BlockFromNodeArgs = {
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

function blockFromNode(args: BlockFromNodeArgs): CortexArticleBlock {
  const node = args.node;
  const line = node.position?.start.line;
  if (typeof line !== 'number') {
    throw new Error('Test Markdown block lacks a source line.');
  }
  if (args.insideNonRenderedHtmlContainer) {
    return { line, type: CortexArticleBlockKind.Separator };
  }
  if (args.insideHtmlContainer) {
    const inspection: VisibleSemanticContentInspection = { node };
    return {
      line,
      type: hasVisibleSemanticContent(inspection)
        ? CortexArticleBlockKind.Structure
        : CortexArticleBlockKind.Separator,
    };
  }
  if (node.type === 'heading') {
    return {
      depth: node.depth,
      line,
      text: nodeText(node),
      type: CortexArticleBlockKind.Heading,
    };
  }
  if (node.type !== 'definition' && node.type !== 'html') {
    const inspection: VisibleSemanticContentInspection = { node };
    if (!hasVisibleSemanticContent(inspection)) {
      return { line, type: CortexArticleBlockKind.Separator };
    }
  }
  if (node.type === 'paragraph' || node.type === 'definition') {
    return {
      line,
      type:
        node.type === 'paragraph'
          ? CortexArticleBlockKind.Paragraph
          : CortexArticleBlockKind.Definition,
    };
  }
  if (node.type === 'list') {
    return {
      line,
      ordered: node.ordered === true,
      type: CortexArticleBlockKind.List,
    };
  }
  if (node.type === 'html') {
    const comment = /^\s*(?:<!--(?:(?!-->)[\s\S])*-->\s*)+$/u.test(node.value);
    if (comment) {
      return { comment, line, type: CortexArticleBlockKind.Html };
    }
    if (!hasVisibleHtmlContent(node.value)) {
      return { line, type: CortexArticleBlockKind.Separator };
    }
    return {
      comment,
      line,
      type: CortexArticleBlockKind.Html,
    };
  }
  if (node.type === 'thematicBreak') {
    return { line, type: CortexArticleBlockKind.Separator };
  }
  if (node.type === 'code' && node.value.trim().length === 0) {
    return { line, type: CortexArticleBlockKind.Separator };
  }
  return { line, type: CortexArticleBlockKind.Structure };
}

function nodeText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (!('children' in node)) return '';
  return node.children.map((child) => nodeText(child as RootContent)).join('');
}

type VisibleSemanticContentInspection = {
  readonly node: Nodes;
};

function hasVisibleSemanticContent(
  inspection: VisibleSemanticContentInspection,
): boolean {
  const node = inspection.node;
  if (node.type === 'definition' || node.type === 'thematicBreak') return false;
  if (node.type === 'html') {
    return hasVisibleHtmlContent(node.value);
  }
  if (
    node.type === 'code' ||
    node.type === 'inlineCode' ||
    node.type === 'text'
  ) {
    return node.value.trim().length > 0;
  }
  if ('children' in node) {
    const childInspection: VisibleSemanticChildrenInspection = {
      children: node.children,
    };
    return childrenHaveVisibleSemanticContent(childInspection);
  }
  return node.type !== 'break';
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
        isNonRenderedHtmlContainer(activeStart.name) &&
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
      }
      continue;
    }
    if (token.kind === HtmlTokenKind.Text && token.value.trim().length > 0) {
      return true;
    }
    if (token.kind !== HtmlTokenKind.Tag) continue;
    const tag = htmlTags(token.value)[0] ?? false;
    if (tag === false) return true;
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
  return isNonRenderedHtmlContainer(normalizedName) ? normalizedName : false;
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
