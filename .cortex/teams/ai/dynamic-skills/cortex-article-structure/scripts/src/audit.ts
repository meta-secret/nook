import {
  ArticleHeadingSelectionKind,
  ArticleBodyContribution,
  ArticleDensityContribution,
  ArticleProcedureRequirement,
  CortexArticleBlock,
  CortexArticleSection,
} from './semantic.ts';

import {
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleHeading,
  type CortexArticleSemanticBlock,
} from './domain.ts';

export class CortexArticleAudit {
  private constructor(
    private readonly request: AuditCortexArticleStructureRequest,
  ) {}

  static formatMarkdownTableFindingMessage(relativePath: string): string {
    const messagePathLimit = Math.min(
      CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
      CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT -
        TABLE_MESSAGE_PREFIX.length -
        TABLE_MESSAGE_SUFFIX.length,
    );
    const boundedPath = relativePath.slice(0, messagePathLimit);
    return `${TABLE_MESSAGE_PREFIX}${boundedPath}${TABLE_MESSAGE_SUFFIX}`;
  }

  static auditCortexArticleStructure(
    request: AuditCortexArticleStructureRequest,
  ): CortexArticleFinding[] {
    return new CortexArticleAudit(request).execute();
  }

  private execute(): CortexArticleFinding[] {
    const request = this.request;
    const findings: CortexArticleFinding[] = [];
    for (const document of request.documents) {
      const documentRequest: AuditDocumentRequest = { document, findings };
      CortexArticleAudit.auditDocument(documentRequest);
    }
    return findings;
  }

  private static auditDocument(request: AuditDocumentRequest): void {
    const { blocks } = request.document;
    for (const block of blocks) {
      if (block.kind !== CortexArticleSemanticKind.Table) continue;
      const findingRequest: AddFindingRequest = {
        findings: request.findings,
        code: CortexArticleFindingCode.MarkdownTable,
        file: request.document.relativePath,
        line: block.line,
        message: CortexArticleAudit.formatMarkdownTableFindingMessage(
          request.document.relativePath,
        ),
      };
      CortexArticleAudit.addFinding(findingRequest);
    }
    for (const [index, block] of blocks.entries()) {
      const selection = new CortexArticleBlock(block).articleHeading();
      if (selection.kind === ArticleHeadingSelectionKind.Other) continue;
      const articleRequest: AuditArticleRequest = {
        document: request.document,
        findings: request.findings,
        heading: selection.heading,
        sectionBlocks: new CortexArticleSection(selection.heading).ownedBlocks({
          blocks: blocks,
          startIndex: index + 1,
        }),
      };
      CortexArticleAudit.auditArticle(articleRequest);
    }
  }

  private static auditArticle(request: AuditArticleRequest): void {
    if (
      !request.sectionBlocks.some(
        (block) =>
          new CortexArticleBlock(block).bodyContribution() ===
          ArticleBodyContribution.Visible,
      )
    ) {
      const findingRequest: AddFindingRequest = {
        findings: request.findings,
        code: CortexArticleFindingCode.EmptyArticle,
        file: request.document.relativePath,
        line: request.heading.line,
        message: `Article #${request.heading.text} has no body content.`,
      };
      CortexArticleAudit.addFinding(findingRequest);
      return;
    }
    CortexArticleAudit.auditConsecutiveParagraphs(request);
    CortexArticleAudit.auditProcedure(request);
  }

  private static auditConsecutiveParagraphs(
    request: AuditArticleRequest,
  ): void {
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
      const findingRequest: AddFindingRequest = {
        findings: request.findings,
        code: CortexArticleFindingCode.DenseArticle,
        file: request.document.relativePath,
        line: block.line,
        message: `Article #${request.heading.text} has more than ${MAX_CONSECUTIVE_PARAGRAPHS} consecutive prose blocks without visible structure.`,
      };
      CortexArticleAudit.addFinding(findingRequest);
    }
  }

  private static auditProcedure(request: AuditArticleRequest): void {
    if (
      new CortexArticleSection(request.heading).procedureRequirement(
        request.sectionBlocks,
      ) !== ArticleProcedureRequirement.OrderedActions
    )
      return;
    const findingRequest: AddFindingRequest = {
      findings: request.findings,
      code: CortexArticleFindingCode.UnorderedProcedure,
      file: request.document.relativePath,
      line: request.heading.line,
      message: `Procedure-like article #${request.heading.text} must expose its action sequence as an ordered list.`,
    };
    CortexArticleAudit.addFinding(findingRequest);
  }

  private static addFinding(request: AddFindingRequest): void {
    const finding: CortexArticleFinding = {
      code: request.code,
      file: request.file,
      line: request.line,
      message: request.message,
    };
    request.findings.push(finding);
  }
}

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

const MAX_CONSECUTIVE_PARAGRAPHS = 3;

const TABLE_MESSAGE_PREFIX = 'Rendered Markdown table in ';

const TABLE_MESSAGE_SUFFIX = ' is prohibited; use an enclosed structured list.';
