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

import { CortexArticleAudit } from './audit.ts';

export class CortexArticleResultVerifier {
  private constructor(
    private readonly request: VerifyCortexArticleStructureResultRequest,
  ) {}

  static verifyCortexArticleStructureResult(
    request: VerifyCortexArticleStructureResultRequest,
  ): void {
    return new CortexArticleResultVerifier(request).execute();
  }

  private execute(): void {
    const request = this.request;
    if (
      request.auditRequest.kind !== CortexArticleContractKind.Request ||
      request.result.kind !== CortexArticleContractKind.Result
    ) {
      throw new Error(VERIFICATION_FAILURE);
    }
    const expected = CortexArticleResultVerifier.independentlyDeriveFindings(
      request.auditRequest,
    );
    if (request.result.findings.length !== expected.length) {
      throw new Error(VERIFICATION_FAILURE);
    }
    for (let index = 0; index < expected.length; index += 1) {
      const [actual = false] = [request.result.findings.at(index)];
      const [wanted = false] = [expected.at(index)];
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

  private static independentlyDeriveFindings(
    request: AuditCortexArticleStructureRequest,
  ): CortexArticleFinding[] {
    const expected: CortexArticleFinding[] = [];
    for (const document of request.documents) {
      const documentRequest: VerifyDocumentRequest = { document, expected };
      CortexArticleResultVerifier.verifyDocument(documentRequest);
    }
    return expected;
  }

  private static verifyDocument(request: VerifyDocumentRequest): void {
    for (const block of request.document.blocks) {
      if (block.kind !== CortexArticleSemanticKind.Table) continue;
      const finding: CortexArticleFinding = {
        code: CortexArticleFindingCode.MarkdownTable,
        file: request.document.relativePath,
        line: block.line,
        message: CortexArticleAudit.formatMarkdownTableFindingMessage(
          request.document.relativePath,
        ),
      };
      request.expected.push(finding);
    }
    for (let index = 0; index < request.document.blocks.length; index += 1) {
      const [block = false] = [request.document.blocks.at(index)];
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
        sectionBlocks: CortexArticleResultVerifier.ownedSection(sectionRequest),
      };
      CortexArticleResultVerifier.verifyArticle(articleRequest);
    }
  }

  private static ownedSection(
    request: OwnedSectionRequest,
  ): readonly CortexArticleSemanticBlock[] {
    const [heading = false] = [request.blocks.at(request.headingIndex)];
    if (
      heading === false ||
      heading.kind !== CortexArticleSemanticKind.Heading
    ) {
      return [];
    }
    let end = request.blocks.length;
    for (
      let index = request.headingIndex + 1;
      index < request.blocks.length;
      index += 1
    ) {
      const [candidate = false] = [request.blocks.at(index)];
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

  private static verifyArticle(request: VerifyArticleRequest): void {
    if (
      !request.sectionBlocks.some(
        CortexArticleResultVerifier.isVisibleArticleBlock,
      )
    ) {
      const finding: CortexArticleFinding = {
        code: CortexArticleFindingCode.EmptyArticle,
        file: request.document.relativePath,
        line: request.heading.line,
        message: `Article #${request.heading.text} has no body content.`,
      };
      request.expected.push(finding);
      return;
    }
    CortexArticleResultVerifier.verifyParagraphDensity(request);
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

  private static verifyParagraphDensity(request: VerifyArticleRequest): void {
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
        block.kind === CortexArticleSemanticKind.Paragraph
          ? consecutive + 1
          : 0;
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

  private static isVisibleArticleBlock(
    block: CortexArticleSemanticBlock,
  ): boolean {
    return (
      block.kind === CortexArticleSemanticKind.Paragraph ||
      block.kind === CortexArticleSemanticKind.VisibleOrderedList ||
      block.kind === CortexArticleSemanticKind.Structure
    );
  }
}

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
