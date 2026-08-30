import type { Nodes, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { executeCortexArticleStructureApplication } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/application.ts';
import {
  CortexArticleContractKind,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/domain.ts';
import type { CortexDocumentSource } from './cortex-document-structure.ts';

export {
  CortexArticleFindingCode,
  type CortexArticleFinding,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/domain.ts';

export type AuditCortexArticleStructureArgs = {
  readonly documents: readonly CortexDocumentSource[];
};

type SemanticDocumentRequest = {
  readonly document: CortexDocumentSource;
};

type SemanticBlockRequest = {
  readonly node: RootContent;
};

type MarkdownContentInspection = {
  readonly node: Nodes;
  readonly excludeProcedureExamples: boolean;
};

const INVISIBLE_TEXT = /[\s\p{Default_Ignorable_Code_Point}]/gu;

export function auditCortexArticleStructure(
  args: AuditCortexArticleStructureArgs,
): CortexArticleFinding[] {
  const documents = args.documents.map((document) => {
    const request: SemanticDocumentRequest = { document };
    return semanticDocument(request);
  });
  const request: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents,
  };
  return [...executeCortexArticleStructureApplication(request).findings];
}

function semanticDocument(
  request: SemanticDocumentRequest,
): CortexArticleDocument {
  const content = request.document.relativePath.endsWith('/SKILL.md')
    ? request.document.content.replace(
        /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,
        (frontmatter) => frontmatter.replace(/[^\r\n]/gu, ' '),
      )
    : request.document.content;
  const root = unified().use(remarkParse).use(remarkGfm).parse(content);
  const blocks = root.children.map((node) => {
    const blockRequest: SemanticBlockRequest = { node };
    return semanticBlock(blockRequest);
  });
  return { relativePath: request.document.relativePath, blocks };
}

function semanticBlock(
  request: SemanticBlockRequest,
): CortexArticleSemanticBlock {
  const line = nodeLine(request.node);
  if (request.node.type === 'heading') {
    return {
      kind: CortexArticleSemanticKind.Heading,
      depth: request.node.depth,
      line,
      text: nodeText(request.node),
    };
  }
  if (isTransparentArticleNode(request.node)) {
    return { kind: CortexArticleSemanticKind.Transparent, line };
  }
  if (request.node.type === 'thematicBreak') {
    return { kind: CortexArticleSemanticKind.DensitySeparator, line };
  }
  if (request.node.type === 'paragraph') {
    if (!isVisibleArticleNode(request.node)) {
      return { kind: CortexArticleSemanticKind.Transparent, line };
    }
    return {
      kind: hasVisibleProseContent(request.node)
        ? CortexArticleSemanticKind.Paragraph
        : CortexArticleSemanticKind.Structure,
      line,
    };
  }
  if (!isVisibleArticleNode(request.node)) {
    return { kind: CortexArticleSemanticKind.Transparent, line };
  }
  return {
    kind: hasVisibleOrderedProcedureList(request.node)
      ? CortexArticleSemanticKind.VisibleOrderedList
      : CortexArticleSemanticKind.Structure,
    line,
  };
}

function isVisibleArticleNode(node: RootContent): boolean {
  if (node.type === 'heading' || isTransparentArticleNode(node)) return false;
  const inspection: MarkdownContentInspection = {
    excludeProcedureExamples: false,
    node,
  };
  return hasVisibleMarkdownContent(inspection);
}

function isTransparentArticleNode(node: RootContent): boolean {
  return node.type === 'definition' || node.type === 'footnoteDefinition';
}

function hasVisibleOrderedProcedureList(node: Nodes): boolean {
  if (
    node.type === 'blockquote' ||
    node.type === 'code' ||
    node.type === 'footnoteDefinition' ||
    node.type === 'html'
  ) {
    return false;
  }
  if (node.type === 'list' && node.ordered === true) {
    const inspection: MarkdownContentInspection = {
      excludeProcedureExamples: true,
      node,
    };
    if (hasVisibleMarkdownContent(inspection)) return true;
  }
  if (!('children' in node)) return false;
  return node.children.some(hasVisibleOrderedProcedureList);
}

function hasVisibleMarkdownContent(
  request: MarkdownContentInspection,
): boolean {
  const node = request.node;
  if (
    request.excludeProcedureExamples &&
    (node.type === 'blockquote' || node.type === 'code')
  ) {
    return false;
  }
  if (
    node.type === 'definition' ||
    node.type === 'footnoteDefinition' ||
    node.type === 'heading' ||
    node.type === 'html' ||
    node.type === 'thematicBreak' ||
    node.type === 'break'
  ) {
    return false;
  }
  if (
    node.type === 'image' ||
    node.type === 'imageReference' ||
    node.type === 'footnoteReference'
  ) {
    return true;
  }
  if (
    !request.excludeProcedureExamples &&
    node.type === 'listItem' &&
    typeof node.checked === 'boolean'
  ) {
    return true;
  }
  if ('value' in node && typeof node.value === 'string') {
    return visibleText(node.value);
  }
  if (!('children' in node)) return false;
  return node.children.some((child) => {
    const childRequest: MarkdownContentInspection = {
      excludeProcedureExamples: request.excludeProcedureExamples,
      node: child,
    };
    return hasVisibleMarkdownContent(childRequest);
  });
}

function hasVisibleProseContent(node: Nodes): boolean {
  if (
    node.type === 'definition' ||
    node.type === 'footnoteDefinition' ||
    node.type === 'footnoteReference' ||
    node.type === 'heading' ||
    node.type === 'html' ||
    node.type === 'image' ||
    node.type === 'imageReference' ||
    node.type === 'thematicBreak' ||
    node.type === 'break'
  ) {
    return false;
  }
  if ('value' in node && typeof node.value === 'string') {
    return visibleText(node.value);
  }
  if (!('children' in node)) return false;
  return node.children.some(hasVisibleProseContent);
}

function visibleText(value: string): boolean {
  return value.replaceAll(INVISIBLE_TEXT, '').length > 0;
}

function nodeText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (!('children' in node)) return '';
  return node.children.map(nodeText).join('');
}

function nodeLine(node: RootContent): number {
  return node.position?.start.line ?? 1;
}
