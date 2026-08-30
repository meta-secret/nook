import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleHeading,
  type CortexArticleSemanticBlock,
  type CortexArticleStructureResult,
} from './domain.ts';

export type VerifyCortexArticleStructureResultRequest = {
  readonly auditRequest: AuditCortexArticleStructureRequest;
  readonly result: CortexArticleStructureResult;
};

type VerifyDocumentRequest = {
  readonly document: CortexArticleDocument;
  readonly expected: CortexArticleFinding[];
};

type VerifyArticleRequest = VerifyDocumentRequest & {
  readonly heading: CortexArticleHeading;
  readonly sectionBlocks: readonly CortexArticleSemanticBlock[];
};

type OwnedSectionRequest = {
  readonly blocks: readonly CortexArticleSemanticBlock[];
  readonly headingIndex: number;
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;
const VERIFICATION_FAILURE =
  'Cortex article-structure semantic verification failed.';

export function verifyCortexArticleStructureResult(
  request: VerifyCortexArticleStructureResultRequest,
): void {
  if (
    request.auditRequest.kind !== CortexArticleContractKind.Request ||
    request.result.kind !== CortexArticleContractKind.Result
  ) {
    throw new Error(VERIFICATION_FAILURE);
  }
  const expected = independentlyDeriveFindings(request.auditRequest);
  if (request.result.findings.length !== expected.length) {
    throw new Error(VERIFICATION_FAILURE);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = request.result.findings.at(index) ?? false;
    const wanted = expected.at(index) ?? false;
    if (
      actual === false ||
      wanted === false ||
      actual.code !== wanted.code ||
      actual.file !== wanted.file ||
      actual.line !== wanted.line ||
      actual.message !== wanted.message
    ) {
      throw new Error(VERIFICATION_FAILURE);
    }
  }
}

function independentlyDeriveFindings(
  request: AuditCortexArticleStructureRequest,
): CortexArticleFinding[] {
  const expected: CortexArticleFinding[] = [];
  for (const document of request.documents) {
    const documentRequest: VerifyDocumentRequest = { document, expected };
    verifyDocument(documentRequest);
  }
  return expected;
}

function verifyDocument(request: VerifyDocumentRequest): void {
  for (let index = 0; index < request.document.blocks.length; index += 1) {
    const block = request.document.blocks.at(index) ?? false;
    if (
      block === false ||
      block.kind !== CortexArticleSemanticKind.Heading ||
      (block.depth !== 2 && block.depth !== 3)
    ) {
      continue;
    }
    const sectionRequest: OwnedSectionRequest = {
      blocks: request.document.blocks,
      headingIndex: index,
    };
    const articleRequest: VerifyArticleRequest = {
      ...request,
      heading: block,
      sectionBlocks: ownedSection(sectionRequest),
    };
    verifyArticle(articleRequest);
  }
}

function ownedSection(
  request: OwnedSectionRequest,
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
    const candidate = request.blocks.at(index) ?? false;
    if (
      candidate !== false &&
      candidate.kind === CortexArticleSemanticKind.Heading &&
      candidate.depth <= heading.depth
    ) {
      end = index;
      break;
    }
  }
  return request.blocks.slice(request.headingIndex + 1, end);
}

function verifyArticle(request: VerifyArticleRequest): void {
  if (!request.sectionBlocks.some(isVisibleArticleBlock)) {
    const finding: CortexArticleFinding = {
      code: CortexArticleFindingCode.EmptyArticle,
      file: request.document.relativePath,
      line: request.heading.line,
      message: `Article #${request.heading.text} has no body content.`,
    };
    request.expected.push(finding);
    return;
  }
  verifyParagraphDensity(request);
  if (
    PROCEDURE_HEADING.test(request.heading.text) &&
    !request.sectionBlocks.some(
      (block) => block.kind === CortexArticleSemanticKind.VisibleOrderedList,
    )
  ) {
    const finding: CortexArticleFinding = {
      code: CortexArticleFindingCode.UnorderedProcedure,
      file: request.document.relativePath,
      line: request.heading.line,
      message: `Procedure-like article #${request.heading.text} must expose its action sequence as an ordered list.`,
    };
    request.expected.push(finding);
  }
}

function verifyParagraphDensity(request: VerifyArticleRequest): void {
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
    consecutive =
      block.kind === CortexArticleSemanticKind.Paragraph ? consecutive + 1 : 0;
    if (consecutive !== MAX_CONSECUTIVE_PARAGRAPHS + 1) continue;
    const finding: CortexArticleFinding = {
      code: CortexArticleFindingCode.DenseArticle,
      file: request.document.relativePath,
      line: block.line,
      message: `Article #${request.heading.text} has more than ${MAX_CONSECUTIVE_PARAGRAPHS} consecutive prose blocks without visible structure.`,
    };
    request.expected.push(finding);
  }
}

function isVisibleArticleBlock(block: CortexArticleSemanticBlock): boolean {
  return (
    block.kind === CortexArticleSemanticKind.Paragraph ||
    block.kind === CortexArticleSemanticKind.VisibleOrderedList ||
    block.kind === CortexArticleSemanticKind.Structure
  );
}
