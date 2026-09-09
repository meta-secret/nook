import { CortexArticleSemanticKind } from './domain.ts';

export enum ArticleBodyContribution {
  Visible = 'visible',
  Incidental = 'incidental',
}

export enum ArticleKindDensityRole {
  Paragraph = 'paragraph',
  Preserve = 'preserve',
  Reset = 'reset',
}

export enum ArticleOrderedActionContribution {
  OrderedActions = 'ordered-actions',
  Other = 'other',
}

/** Owns the semantics determined solely by the canonical wire kind. */
export class CortexArticleKind {
  constructor(private readonly kind: CortexArticleSemanticKind) {}

  bodyContribution(): ArticleBodyContribution {
    switch (this.kind) {
      case CortexArticleSemanticKind.Paragraph:
      case CortexArticleSemanticKind.VisibleOrderedList:
      case CortexArticleSemanticKind.Structure:
        return ArticleBodyContribution.Visible;
      case CortexArticleSemanticKind.Heading:
      case CortexArticleSemanticKind.Transparent:
      case CortexArticleSemanticKind.DensitySeparator:
      case CortexArticleSemanticKind.Table:
        return ArticleBodyContribution.Incidental;
    }
  }

  densityRole(): ArticleKindDensityRole {
    switch (this.kind) {
      case CortexArticleSemanticKind.Transparent:
        return ArticleKindDensityRole.Preserve;
      case CortexArticleSemanticKind.Paragraph:
        return ArticleKindDensityRole.Paragraph;
      case CortexArticleSemanticKind.Heading:
      case CortexArticleSemanticKind.VisibleOrderedList:
      case CortexArticleSemanticKind.Structure:
      case CortexArticleSemanticKind.DensitySeparator:
      case CortexArticleSemanticKind.Table:
        return ArticleKindDensityRole.Reset;
    }
  }

  orderedActionContribution(): ArticleOrderedActionContribution {
    return this.kind === CortexArticleSemanticKind.VisibleOrderedList
      ? ArticleOrderedActionContribution.OrderedActions
      : ArticleOrderedActionContribution.Other;
  }
}
