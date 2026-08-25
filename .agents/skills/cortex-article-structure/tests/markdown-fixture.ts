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
  return parser.parse(content).children.map(blockFromNode);
}

function blockFromNode(node: RootContent): CortexArticleBlock {
  const line = node.position?.start.line;
  if (typeof line !== 'number') {
    throw new Error('Test Markdown block lacks a source line.');
  }
  if (node.type === 'heading') {
    return {
      depth: node.depth,
      line,
      text: nodeText(node),
      type: CortexArticleBlockKind.Heading,
    };
  }
  if (node.type === 'blockquote' || node.type === 'list') {
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
    if (
      /^\s*(?:(?:<!--(?:(?!-->)[\s\S])*-->)|(?:<(?:hr|br)\b(?:\s+[^<>]*?)?\s*\/?>)\s*)+$/iu.test(
        node.value,
      )
    ) {
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
    return !/^\s*(?:(?:<!--(?:(?!-->)[\s\S])*-->)|(?:<(?:hr|br)\b(?:\s+[^<>]*?)?\s*\/?>)\s*)+$/iu.test(
      node.value,
    );
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
