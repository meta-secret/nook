import {
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleHeading,
  type CortexArticleSemanticBlock,
} from './domain.ts';

type AddFindingRequest = {
  readonly findings: CortexArticleFinding[];
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

type AuditDocumentRequest = {
  readonly document: CortexArticleDocument;
  readonly findings: CortexArticleFinding[];
};

type AuditArticleRequest = AuditDocumentRequest & {
  readonly heading: CortexArticleHeading;
  readonly sectionBlocks: readonly CortexArticleSemanticBlock[];
};

type OwnedSectionBlocksRequest = {
  readonly blocks: readonly CortexArticleSemanticBlock[];
  readonly headingIndex: number;
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;

export function auditCortexArticleStructure(
  request: AuditCortexArticleStructureRequest,
): CortexArticleFinding[] {
  const findings: CortexArticleFinding[] = [];
  for (const document of request.documents) {
    const documentRequest: AuditDocumentRequest = { document, findings };
    auditDocument(documentRequest);
  }
  return findings;
}

function auditDocument(request: AuditDocumentRequest): void {
  const { blocks } = request.document;
  for (const block of blocks) {
    if (block.kind !== CortexArticleSemanticKind.Table) continue;
    const findingRequest: AddFindingRequest = {
      findings: request.findings,
      code: CortexArticleFindingCode.MarkdownTable,
      file: request.document.relativePath,
      line: block.line,
      message: `Rendered Markdown table in ${request.document.relativePath} is prohibited; use an enclosed structured list.`,
    };
    addFinding(findingRequest);
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks.at(index) ?? false;
    if (
      block === false ||
      block.kind !== CortexArticleSemanticKind.Heading ||
      (block.depth !== 2 && block.depth !== 3)
    ) {
      continue;
    }
    const sectionRequest: OwnedSectionBlocksRequest = {
      blocks,
      headingIndex: index,
    };
    const articleRequest: AuditArticleRequest = {
      document: request.document,
      findings: request.findings,
      heading: block,
      sectionBlocks: ownedSectionBlocks(sectionRequest),
    };
    auditArticle(articleRequest);
  }
}

function ownedSectionBlocks(
  request: OwnedSectionBlocksRequest,
): readonly CortexArticleSemanticBlock[] {
  const heading = request.blocks.at(request.headingIndex) ?? false;
  if (heading === false || heading.kind !== CortexArticleSemanticKind.Heading) {
    return [];
  }
  let end = request.blocks.length;
  for (
    let index = request.headingIndex + 1;
    index < request.blocks.length;
    index += 1
  ) {
    const block = request.blocks.at(index);
    if (
      block?.kind === CortexArticleSemanticKind.Heading &&
      block.depth <= heading.depth
    ) {
      end = index;
      break;
    }
  }
  return request.blocks.slice(request.headingIndex + 1, end);
}

function auditArticle(request: AuditArticleRequest): void {
  if (!request.sectionBlocks.some(isVisibleArticleBlock)) {
    const findingRequest: AddFindingRequest = {
      findings: request.findings,
      code: CortexArticleFindingCode.EmptyArticle,
      file: request.document.relativePath,
      line: request.heading.line,
      message: `Article #${request.heading.text} has no body content.`,
    };
    addFinding(findingRequest);
    return;
  }
  auditConsecutiveParagraphs(request);
  auditProcedure(request);
}

function isVisibleArticleBlock(block: CortexArticleSemanticBlock): boolean {
  return (
    block.kind === CortexArticleSemanticKind.Paragraph ||
    block.kind === CortexArticleSemanticKind.VisibleOrderedList ||
    block.kind === CortexArticleSemanticKind.Structure
  );
}

function auditConsecutiveParagraphs(request: AuditArticleRequest): void {
  let consecutive = 0;
  for (const block of request.sectionBlocks) {
    if (block.kind === CortexArticleSemanticKind.Heading) {
      if (block.depth <= 3) break;
      consecutive = 0;
      continue;
    }
    if (block.kind === CortexArticleSemanticKind.Transparent) continue;
    if (block.kind === CortexArticleSemanticKind.DensitySeparator) {
      consecutive = 0;
      continue;
    }
    if (block.kind !== CortexArticleSemanticKind.Paragraph) {
      consecutive = 0;
      continue;
    }
    consecutive += 1;
    if (consecutive !== MAX_CONSECUTIVE_PARAGRAPHS + 1) continue;
    const findingRequest: AddFindingRequest = {
      findings: request.findings,
      code: CortexArticleFindingCode.DenseArticle,
      file: request.document.relativePath,
      line: block.line,
      message: `Article #${request.heading.text} has more than ${MAX_CONSECUTIVE_PARAGRAPHS} consecutive prose blocks without visible structure.`,
    };
    addFinding(findingRequest);
  }
}

function auditProcedure(request: AuditArticleRequest): void {
  if (!PROCEDURE_HEADING.test(request.heading.text)) return;
  const hasVisibleOrderedList = request.sectionBlocks.some(
    (block) => block.kind === CortexArticleSemanticKind.VisibleOrderedList,
  );
  if (hasVisibleOrderedList) return;
  const findingRequest: AddFindingRequest = {
    findings: request.findings,
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: request.document.relativePath,
    line: request.heading.line,
    message: `Procedure-like article #${request.heading.text} must expose its action sequence as an ordered list.`,
  };
  addFinding(findingRequest);
}

function addFinding(request: AddFindingRequest): void {
  const finding: CortexArticleFinding = {
    code: request.code,
    file: request.file,
    line: request.line,
    message: request.message,
  };
  request.findings.push(finding);
}
