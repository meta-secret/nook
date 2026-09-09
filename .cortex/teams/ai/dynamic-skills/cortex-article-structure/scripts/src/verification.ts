import {
  ArticleHeadingSelectionKind,
  ArticleBodyContribution,
  ArticleDensityContribution,
  ArticleProcedureRequirement,
  ArticleFindingAgreement,
  CortexArticleBlock,
  CortexArticleSection,
  CortexArticleFindingSequence,
} from './semantic.ts';

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

  static from(
    request: VerifyCortexArticleStructureResultRequest,
  ): CortexArticleResultVerifier {
    return new CortexArticleResultVerifier(request);
  }

  public execute(): void {
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
    if (
      new CortexArticleFindingSequence(request.result.findings).agreementWith(
        expected,
      ) === ArticleFindingAgreement.Different
    ) {
      throw new Error(VERIFICATION_FAILURE);
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
    for (const [index, block] of request.document.blocks.entries()) {
      const selection = new CortexArticleBlock(block).articleHeading();
      if (selection.kind === ArticleHeadingSelectionKind.Other) continue;
      const articleRequest: VerifyArticleRequest = {
        ...request,
        heading: selection.heading,
        sectionBlocks: new CortexArticleSection(selection.heading).ownedBlocks({
          blocks: request.document.blocks,
          startIndex: index + 1,
        }),
      };
      CortexArticleResultVerifier.verifyArticle(articleRequest);
    }
  }

  private static verifyArticle(request: VerifyArticleRequest): void {
    if (
      !request.sectionBlocks.some(
        (block) =>
          new CortexArticleBlock(block).bodyContribution() ===
          ArticleBodyContribution.Visible,
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
      new CortexArticleSection(request.heading).procedureRequirement(
        request.sectionBlocks,
      ) === ArticleProcedureRequirement.OrderedActions
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
      const contribution = new CortexArticleBlock(block).densityContribution();
      if (contribution === ArticleDensityContribution.EndArticle) break;
      if (contribution === ArticleDensityContribution.Preserve) continue;
      if (contribution === ArticleDensityContribution.Reset) {
        consecutive = 0;
        continue;
      }
      consecutive += 1;
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

const MAX_CONSECUTIVE_PARAGRAPHS = 3;

const VERIFICATION_FAILURE =
  'Cortex article-structure semantic verification failed.';
