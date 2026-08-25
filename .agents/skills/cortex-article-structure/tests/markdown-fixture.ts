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
    const args: BlockFromNodeArgs = {
      insideHtmlContainer: (containerDepths[index] ?? 0) > 0,
      node,
    };
    blocks.push(blockFromNode(args));
  }
  return blocks;
}

type BlockFromNodeArgs = {
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

type HtmlToken = {
  readonly kind: 'comment' | 'tag' | 'text';
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

function blockFromNode(args: BlockFromNodeArgs): CortexArticleBlock {
  const node = args.node;
  const line = node.position?.start.line;
  if (typeof line !== 'number') {
    throw new Error('Test Markdown block lacks a source line.');
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
    return node.children.some((child) => {
      const childInspection: VisibleSemanticContentInspection = { node: child };
      return hasVisibleSemanticContent(childInspection);
    });
  }
  return node.type !== 'break';
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
      const start = starts[startIndex];
      if (start === undefined) continue;
      for (let index = start.nodeIndex + 1; index < nodeIndex; index += 1) {
        depths[index] = (depths[index] ?? 0) + 1;
      }
      starts.splice(startIndex, 1);
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
    if (token.kind !== 'tag') continue;
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
    if (token.kind === 'text' && token.value.trim().length > 0) return true;
    if (token.kind !== 'tag') continue;
    const tag = htmlTags(token.value)[0];
    if (tag === undefined) return true;
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
        const token: HtmlToken = { kind: 'text', value: value.slice(cursor) };
        tokens.push(token);
        break;
      }
      const token: HtmlToken = {
        kind: 'comment',
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
          kind: 'tag',
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
      kind: 'text',
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
