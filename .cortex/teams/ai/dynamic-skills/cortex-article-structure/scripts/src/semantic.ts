import {
  CortexArticleKind,
  ArticleBodyContribution,
  ArticleKindDensityRole,
  ArticleOrderedActionContribution,
} from './semantic-kind.ts';
export { ArticleBodyContribution } from './semantic-kind.ts';

import {
  CortexArticleSemanticKind,
  type CortexArticleHeading,
  type CortexArticleSemanticBlock,
  type CortexArticleFinding,
} from './domain.ts';

export enum ArticleHeadingSelectionKind {
  Article = 'article',
  Other = 'other',
}

export type ArticleHeadingSelection =
  | {
      readonly kind: ArticleHeadingSelectionKind.Article;
      readonly heading: CortexArticleHeading;
    }
  | { readonly kind: ArticleHeadingSelectionKind.Other };

export enum ArticleDensityContribution {
  EndArticle = 'end-article',
  Paragraph = 'paragraph',
  Preserve = 'preserve',
  Reset = 'reset',
}

export enum ArticleSectionBoundary {
  End = 'end',
  Continue = 'continue',
}

export enum ArticleProcedureRequirement {
  OrderedActions = 'ordered-actions',
  Unrestricted = 'unrestricted',
  Satisfied = 'satisfied',
}

export enum ArticleFindingAgreement {
  Identical = 'identical',
  Different = 'different',
}

/** Owns interpretation of an admitted semantic block, retaining its wire record. */
export class CortexArticleBlock {
  private readonly kind: CortexArticleKind;

  constructor(private readonly block: CortexArticleSemanticBlock) {
    this.kind = new CortexArticleKind(block.kind);
  }

  articleHeading(): ArticleHeadingSelection {
    if (this.block.kind !== CortexArticleSemanticKind.Heading) {
      return { kind: ArticleHeadingSelectionKind.Other };
    }
    switch (this.block.depth) {
      case 2:
      case 3:
        return {
          kind: ArticleHeadingSelectionKind.Article,
          heading: this.block,
        };
      default:
        return { kind: ArticleHeadingSelectionKind.Other };
    }
  }

  boundaryFor(heading: CortexArticleHeading): ArticleSectionBoundary {
    if (this.block.kind !== CortexArticleSemanticKind.Heading) {
      return ArticleSectionBoundary.Continue;
    }
    return this.block.depth <= heading.depth
      ? ArticleSectionBoundary.End
      : ArticleSectionBoundary.Continue;
  }

  bodyContribution(): ArticleBodyContribution {
    return this.kind.bodyContribution();
  }

  orderedActionContribution(): ArticleOrderedActionContribution {
    return this.kind.orderedActionContribution();
  }

  densityContribution(): ArticleDensityContribution {
    if (this.block.kind === CortexArticleSemanticKind.Heading) {
      return this.block.depth <= 3
        ? ArticleDensityContribution.EndArticle
        : ArticleDensityContribution.Reset;
    }
    switch (this.kind.densityRole()) {
      case ArticleKindDensityRole.Preserve:
        return ArticleDensityContribution.Preserve;
      case ArticleKindDensityRole.Paragraph:
        return ArticleDensityContribution.Paragraph;
      case ArticleKindDensityRole.Reset:
        return ArticleDensityContribution.Reset;
    }
  }
}

type ArticleFollowingBlocks = {
  readonly blocks: readonly CortexArticleSemanticBlock[];
  readonly startIndex: number;
};

export class CortexArticleSection {
  constructor(private readonly heading: CortexArticleHeading) {}

  ownedBlocks(
    request: ArticleFollowingBlocks,
  ): readonly CortexArticleSemanticBlock[] {
    let end = request.blocks.length;
    for (const [index, block] of request.blocks.entries()) {
      if (index < request.startIndex) continue;
      if (
        new CortexArticleBlock(block).boundaryFor(this.heading) ===
        ArticleSectionBoundary.End
      ) {
        end = index;
        break;
      }
    }
    return request.blocks.slice(request.startIndex, end);
  }

  procedureRequirement(
    blocks: readonly CortexArticleSemanticBlock[],
  ): ArticleProcedureRequirement {
    if (!PROCEDURE_HEADING.test(this.heading.text))
      return ArticleProcedureRequirement.Unrestricted;
    return blocks.some(
      (block) =>
        new CortexArticleBlock(block).orderedActionContribution() ===
        ArticleOrderedActionContribution.OrderedActions,
    )
      ? ArticleProcedureRequirement.Satisfied
      : ArticleProcedureRequirement.OrderedActions;
  }
}

export class CortexArticleFindingSequence {
  constructor(private readonly findings: readonly CortexArticleFinding[]) {}

  agreementWith(
    expected: readonly CortexArticleFinding[],
  ): ArticleFindingAgreement {
    if (this.findings.length !== expected.length)
      return ArticleFindingAgreement.Different;
    for (const [index, wanted] of expected.entries()) {
      const actual = this.findings.at(index);
      if (actual === undefined) return ArticleFindingAgreement.Different;
      if (
        new CortexArticleFindingValue(actual).agreementWith(wanted) ===
        ArticleFindingAgreement.Different
      ) {
        return ArticleFindingAgreement.Different;
      }
    }
    return ArticleFindingAgreement.Identical;
  }
}

class CortexArticleFindingValue {
  constructor(private readonly finding: CortexArticleFinding) {}

  agreementWith(expected: CortexArticleFinding): ArticleFindingAgreement {
    return this.finding.code === expected.code &&
      this.finding.file === expected.file &&
      this.finding.line === expected.line &&
      this.finding.message === expected.message
      ? ArticleFindingAgreement.Identical
      : ArticleFindingAgreement.Different;
  }
}

const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;
