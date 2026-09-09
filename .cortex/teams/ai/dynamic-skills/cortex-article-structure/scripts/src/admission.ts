import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_FINDING_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleFinding,
  type CortexArticleStructureResult,
} from './domain.ts';
import { CortexArticleAudit } from './audit.ts';
import { CORTEX_ARTICLE_MARKDOWN_PATH_SCHEMA } from './schema.ts';
import {
  CortexArticleRequestDecodeError,
  CortexArticleRequestFailureKind,
} from './decode-error.ts';

export class CortexArticleRequestCapacity {
  constructor(private readonly request: AuditCortexArticleStructureRequest) {}
  assertWithinBounds(): void {
    const request = this.request;
    const findings = CortexArticleAudit.from(request).execute();
    const contributor = this.findingContributorPath(findings);
    if (findings.length > CORTEX_ARTICLE_FINDING_LIMIT) {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.FindingCapacity,
        path: contributor,
      });
    }
    const result: CortexArticleStructureResult = {
      kind: CortexArticleContractKind.Result,
      findings,
    };
    if (
      UTF8_ENCODER.encode(JSON.stringify(result)).byteLength >
      CORTEX_ARTICLE_RESULT_BYTE_LIMIT
    ) {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.ResultBudget,
        path: contributor,
      });
    }
  }

  private findingContributorPath(
    findings: readonly CortexArticleFinding[],
  ): string {
    const finding = findings.at(-1);
    if (!finding) return 'documents';
    const documentIndex = this.request.documents.findIndex(
      (document) => document.relativePath === finding.file,
    );
    if (documentIndex < 0) return 'documents';
    const blockIndex = this.request.documents
      .at(documentIndex)
      ?.blocks.findIndex((block) => block.line === finding.line);
    return typeof blockIndex === 'number' && blockIndex >= 0
      ? `documents[${documentIndex}].blocks[${blockIndex}]`
      : `documents[${documentIndex}]`;
  }
}

export class CortexArticleFindingAdmission {
  constructor(private readonly finding: CortexArticleFinding) {}

  assertCanonical(): void {
    if (
      !CORTEX_ARTICLE_MARKDOWN_PATH_SCHEMA.safeParse(this.finding.file).success
    ) {
      throw new Error('Invalid Cortex article finding diagnostics.');
    }
    const shape = new CortexArticleDiagnosticKind(this.finding.code).shape();
    if (
      shape.match(this.finding.message) === CortexArticleDiagnosticMatch.Invalid
    ) {
      throw new Error('Invalid Cortex article finding diagnostics.');
    }
  }
}

enum CortexArticleDiagnosticMatch {
  Canonical = 'canonical',
  Invalid = 'invalid',
}

type DiagnosticShape = { readonly prefix: string; readonly suffix: string };

class CortexArticleDiagnosticShape {
  constructor(private readonly shape: DiagnosticShape) {}

  match(message: string): CortexArticleDiagnosticMatch {
    if (
      !message.startsWith(this.shape.prefix) ||
      !message.endsWith(this.shape.suffix)
    ) {
      return CortexArticleDiagnosticMatch.Invalid;
    }
    const detailLength =
      message.length - this.shape.prefix.length - this.shape.suffix.length;
    return detailLength >= 0 && detailLength <= CORTEX_ARTICLE_DETAIL_TEXT_LIMIT
      ? CortexArticleDiagnosticMatch.Canonical
      : CortexArticleDiagnosticMatch.Invalid;
  }
}

class CortexArticleDiagnosticKind {
  constructor(private readonly code: CortexArticleFindingCode) {}

  shape(): CortexArticleDiagnosticShape {
    switch (this.code) {
      case CortexArticleFindingCode.EmptyArticle:
        return new CortexArticleDiagnosticShape({
          prefix: 'Article #',
          suffix: ' has no body content.',
        });
      case CortexArticleFindingCode.DenseArticle:
        return new CortexArticleDiagnosticShape({
          prefix: 'Article #',
          suffix:
            ' has more than 3 consecutive prose blocks without visible structure.',
        });
      case CortexArticleFindingCode.MarkdownTable:
        return new CortexArticleDiagnosticShape({
          prefix: 'Rendered Markdown table in ',
          suffix: ' is prohibited; use an enclosed structured list.',
        });
      case CortexArticleFindingCode.UnorderedProcedure:
        return new CortexArticleDiagnosticShape({
          prefix: 'Procedure-like article #',
          suffix: ' must expose its action sequence as an ordered list.',
        });
    }
  }
}
const UTF8_ENCODER = new TextEncoder();
