import {
  CortexProseNode,
  CortexProseContext,
  CortexProseInspection,
} from './cortex-prose-node.ts';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type DensityFinding = {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly excerpt: string;
};

export type DensityFindingSpan = DensityFinding & {
  readonly endLine: number;
};

/** Owns the cortex prose density registry and its capability transitions. */
export class CortexProseDensity {
  private constructor() {}
  private static readonly MAX_AND_JOINS = 2;

  static lintProseDensity(args: LintProseDensityArgs): DensityFinding[] {
    return CortexProseDensity.lintProseDensitySpans(args).map((findingSpan) => {
      const { endLine: _endLine, ...finding } = findingSpan;
      return finding;
    });
  }

  static lintProseDensitySpans(
    args: LintProseDensityArgs,
  ): DensityFindingSpan[] {
    const { filePath, content } = args;
    const findings: DensityFindingSpan[] = [];
    const root = unified().use(remarkParse).use(remarkGfm).parse(content);
    const inspectArgs: InspectMarkdownNodeArgs = {
      filePath,
      findings,
      context: CortexProseContext.Body,
      node: new CortexProseNode(root),
    };
    CortexProseDensity.inspectMarkdownNode(inspectArgs);

    return findings;
  }

  private static inspectMarkdownNode(args: InspectMarkdownNodeArgs): void {
    switch (args.node.inspection(args.context)) {
      case CortexProseInspection.Excluded:
        return;
      case CortexProseInspection.Inspect:
        CortexProseDensity.inspectProseBlock({
          filePath: args.filePath,
          findings: args.findings,
          proseBlock: args.node,
        });
        return;
      case CortexProseInspection.Descend:
        for (const child of args.node.children()) {
          CortexProseDensity.inspectMarkdownNode({
            ...args,
            context: args.node.childContext(args.context),
            node: child,
          });
        }
    }
  }

  private static inspectProseBlock(args: InspectProseBlockArgs): void {
    const text = args.proseBlock.text().replace(/\s+/gu, ' ').trim();
    if (text.length === 0) return;
    const { line } = args.proseBlock.sourceSpan();
    for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
      const sentenceArgs: AddSentenceFindingsArgs = {
        ...args,
        line,
        sentence,
      };
      CortexProseDensity.addSentenceFindings(sentenceArgs);
    }
  }

  private static addSentenceFindings(args: AddSentenceFindingsArgs): void {
    const { endLine } = args.proseBlock.sourceSpan();
    const findingBase = {
      file: args.filePath,
      line: args.line,
      endLine,
      excerpt: args.sentence.slice(0, 120),
    };
    const [andJoins = 0] = [args.sentence.match(/\sand\s/giu)?.length];
    if (
      andJoins > CortexProseDensity.MAX_AND_JOINS &&
      args.sentence.length > 120
    ) {
      const joinsFinding: DensityFindingSpan = {
        ...findingBase,
        reason: 'many "and" joins in a long sentence',
      };
      args.findings.push(joinsFinding);
    }
  }
}

export type LintProseDensityArgs = {
  readonly filePath: string;
  readonly content: string;
};

type InspectMarkdownNodeArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly context: CortexProseContext;
  readonly node: CortexProseNode;
};

type InspectProseBlockArgs = {
  readonly filePath: string;
  readonly findings: DensityFindingSpan[];
  readonly proseBlock: CortexProseNode;
};

type AddSentenceFindingsArgs = InspectProseBlockArgs & {
  readonly line: number;
  readonly sentence: string;
};
