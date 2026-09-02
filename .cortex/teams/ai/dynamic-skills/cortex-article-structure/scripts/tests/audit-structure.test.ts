import { expect, test } from 'bun:test';
import {
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type CortexArticleSemanticBlock,
} from '../src/domain.ts';
import {
  audit,
  makeDocument,
  type MakeAuditRequest,
  type MakeDocumentRequest,
} from './support.ts';

type SemanticBlocks = readonly CortexArticleSemanticBlock[];

const headingAtDepth = (depth: number) => (line: number) => (text: string) => ({
  depth,
  kind: CortexArticleSemanticKind.Heading,
  line,
  text,
});
const headingAt = headingAtDepth(2);
const heading = headingAt(1);
const simpleBlock =
  (
    kind: Exclude<CortexArticleSemanticKind, CortexArticleSemanticKind.Heading>,
  ) =>
  (line: number): CortexArticleSemanticBlock => ({ kind, line });
const paragraph = simpleBlock(CortexArticleSemanticKind.Paragraph);
const structure = simpleBlock(CortexArticleSemanticKind.Structure);
const transparent = simpleBlock(CortexArticleSemanticKind.Transparent);
const densitySeparator = simpleBlock(
  CortexArticleSemanticKind.DensitySeparator,
);
const visibleOrderedList = simpleBlock(
  CortexArticleSemanticKind.VisibleOrderedList,
);
const table = simpleBlock(CortexArticleSemanticKind.Table);

function findingsFor(blocks: SemanticBlocks) {
  const documentRequest: MakeDocumentRequest = {
    blocks,
    relativePath: '.cortex/article.md',
  };
  const document = makeDocument(documentRequest);
  const auditRequest: MakeAuditRequest = { documents: [document] };
  return audit(auditRequest);
}

test('accepts visible structure and visible ordered procedures', () => {
  const blocks = [
    heading('Purpose'),
    paragraph(3),
    structure(5),
    headingAt(7)('Recovery procedure'),
    paragraph(9),
    visibleOrderedList(11),
  ];
  expect(findingsFor(blocks)).toEqual([]);
});

test('reports every rendered Markdown table', () => {
  const blocks = [heading('Reference'), paragraph(3), table(5), table(9)];
  expect(findingsFor(blocks)).toEqual([
    {
      code: CortexArticleFindingCode.MarkdownTable,
      file: '.cortex/article.md',
      line: 5,
      message:
        'Rendered Markdown table in .cortex/article.md is prohibited; use an enclosed structured list.',
    },
    {
      code: CortexArticleFindingCode.MarkdownTable,
      file: '.cortex/article.md',
      line: 9,
      message:
        'Rendered Markdown table in .cortex/article.md is prohibited; use an enclosed structured list.',
    },
  ]);
});

test('reports empty articles with active heading diagnostics', () => {
  const blocks = [
    headingAt(7)('Empty article'),
    transparent(9),
    densitySeparator(11),
  ];
  expect(findingsFor(blocks)).toEqual([
    {
      code: CortexArticleFindingCode.EmptyArticle,
      file: '.cortex/article.md',
      line: 7,
      message: 'Article #Empty article has no body content.',
    },
  ]);
});

test('reports the fourth consecutive paragraph at its source line', () => {
  const blocks = [
    headingAt(2)('Explanation'),
    paragraph(4),
    transparent(6),
    paragraph(8),
    paragraph(10),
    paragraph(12),
  ];
  expect(findingsFor(blocks)).toEqual([
    {
      code: CortexArticleFindingCode.DenseArticle,
      file: '.cortex/article.md',
      line: 12,
      message:
        'Article #Explanation has more than 3 consecutive prose blocks without visible structure.',
    },
  ]);
});

test('density separators reset prose without becoming visible content', () => {
  const structuredBlocks = [
    heading('Explanation'),
    paragraph(3),
    paragraph(5),
    paragraph(7),
    densitySeparator(9),
    paragraph(11),
  ];
  expect(findingsFor(structuredBlocks)).toEqual([]);
  const emptyBlocks = [heading('Empty'), densitySeparator(3)];
  expect(findingsFor(emptyBlocks)).toHaveLength(1);
});

test('visible structure resets prose density', () => {
  const structures = [structure, visibleOrderedList];
  for (const semanticStructure of structures) {
    const blocks = [
      heading('Explanation'),
      paragraph(3),
      paragraph(5),
      paragraph(7),
      semanticStructure(9),
      paragraph(11),
    ];
    expect(findingsFor(blocks)).toEqual([]);
  }
});

test('nested H4 headings reset density without ending the owning H3 scan', () => {
  const h3 = headingAtDepth(3);
  const h4 = headingAtDepth(4);
  const blocks = [
    h3(1)('Explanation'),
    paragraph(3),
    paragraph(5),
    paragraph(7),
    h4(9)('Nested detail'),
    paragraph(11),
    paragraph(13),
    paragraph(15),
    paragraph(17),
  ];
  expect(findingsFor(blocks)).toEqual([
    {
      code: CortexArticleFindingCode.DenseArticle,
      file: '.cortex/article.md',
      line: 17,
      message:
        'Article #Explanation has more than 3 consecutive prose blocks without visible structure.',
    },
  ]);
});

test('requires an explicit visible ordered-list semantic state', () => {
  const blocks = [
    headingAt(4)('Recovery procedure'),
    paragraph(6),
    structure(8),
  ];
  expect(findingsFor(blocks)).toEqual([
    {
      code: CortexArticleFindingCode.UnorderedProcedure,
      file: '.cortex/article.md',
      line: 4,
      message:
        'Procedure-like article #Recovery procedure must expose its action sequence as an ordered list.',
    },
  ]);
});

test('recognizes the active procedure-heading vocabulary', () => {
  const headings = [
    'Procedure for recovery',
    'Runbook: release',
    'Release steps',
    'Staged delivery sequence',
    'Ordered delivery for production',
    'Recovery procedures',
    'Deployment runbooks',
    'Delivery sequences for recovery',
    'Ordered deliveries for production',
  ];
  for (const text of headings) {
    const blocks = [heading(text), paragraph(3)];
    expect(findingsFor(blocks).map((finding) => finding.code)).toEqual([
      CortexArticleFindingCode.UnorderedProcedure,
    ]);
  }
});

test('honors H2 and H3 ownership boundaries and ignores H1 titles', () => {
  const h1 = headingAtDepth(1);
  const h3 = headingAtDepth(3);
  const blocks = [
    h1(1)('Title'),
    headingAt(3)('Parent explanation'),
    paragraph(5),
    h3(7)('Child explanation'),
    paragraph(9),
    headingAt(11)('Next explanation'),
    paragraph(13),
  ];
  expect(findingsFor(blocks)).toEqual([]);
  const titleOnly = [h1(1)('Title')];
  expect(findingsFor(titleOnly)).toEqual([]);
});
