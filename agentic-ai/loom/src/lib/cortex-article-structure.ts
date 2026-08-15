import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Heading, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { CortexDocumentSource } from './cortex-document-structure.ts';

export enum CortexArticleFindingCode {
  InvalidMigrationLedger = 'invalid-article-migration-ledger',
  EmptyArticle = 'empty-article',
  DenseArticle = 'dense-article',
  UnorderedProcedure = 'unordered-procedure',
}

export type CortexArticleFinding = {
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type AuditCortexArticleStructureArgs = {
  readonly documents: readonly CortexDocumentSource[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerPath: string;
  readonly repoRoot: string;
};

type ParsedArticleDocument = CortexDocumentSource & {
  readonly root: Root;
};

type AddFindingArgs = {
  readonly findings: CortexArticleFinding[];
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

type ReadMigrationExemptionsArgs = {
  readonly catalog: ReadonlySet<string>;
  readonly findings: CortexArticleFinding[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerPath: string;
  readonly repoRoot: string;
};

type AuditDocumentArgs = {
  readonly document: ParsedArticleDocument;
  readonly findings: CortexArticleFinding[];
};

type AuditArticleArgs = AuditDocumentArgs & {
  readonly heading: Heading;
  readonly sectionNodes: readonly RootContent[];
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedure|runbook|steps|ordered delivery|delivery sequence)\b/i;

export function auditCortexArticleStructure(
  args: AuditCortexArticleStructureArgs,
): CortexArticleFinding[] {
  const findings: CortexArticleFinding[] = [];
  const documents = args.documents.map(parseDocument);
  const catalog = new Set(documents.map((document) => document.relativePath));
  const exemptionArgs: ReadMigrationExemptionsArgs = {
    catalog,
    findings,
    migrationBaselineEntries: args.migrationBaselineEntries,
    migrationLedgerPath: args.migrationLedgerPath,
    repoRoot: args.repoRoot,
  };
  const exemptions = readMigrationExemptions(exemptionArgs);

  for (const document of documents) {
    if (exemptions.has(document.relativePath)) {
      continue;
    }
    const documentArgs: AuditDocumentArgs = { document, findings };
    auditDocument(documentArgs);
  }

  return findings;
}

function parseDocument(document: CortexDocumentSource): ParsedArticleDocument {
  const root = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(document.content);
  return { ...document, root };
}

function readMigrationExemptions(
  args: ReadMigrationExemptionsArgs,
): ReadonlySet<string> {
  let content: string;
  try {
    content = readFileSync(args.migrationLedgerPath, 'utf8');
  } catch {
    return new Set<string>();
  }

  const exemptions = new Set<string>();
  const baseline =
    args.migrationBaselineEntries === false
      ? false
      : new Set(args.migrationBaselineEntries);
  const ledgerFile = path.relative(args.repoRoot, args.migrationLedgerPath);
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const entry = (lines[index] ?? '').trim();
    if (entry.length === 0 || entry.startsWith('#')) {
      continue;
    }
    const invalidMessageArgs: InvalidLedgerMessageArgs = {
      baseline,
      catalog: args.catalog,
      entry,
      exemptions,
    };
    const message = invalidLedgerMessage(invalidMessageArgs);
    if (message !== false) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexArticleFindingCode.InvalidMigrationLedger,
        file: ledgerFile,
        line: index + 1,
        message,
      };
      addFinding(findingArgs);
      continue;
    }
    exemptions.add(entry);
  }

  return exemptions;
}

type InvalidLedgerMessageArgs = {
  readonly baseline: ReadonlySet<string> | false;
  readonly catalog: ReadonlySet<string>;
  readonly entry: string;
  readonly exemptions: ReadonlySet<string>;
};

function invalidLedgerMessage(args: InvalidLedgerMessageArgs): string | false {
  if (args.exemptions.has(args.entry)) {
    return `Duplicate article-structure migration exemption: ${args.entry}`;
  }
  if (!args.catalog.has(args.entry)) {
    return `Article-structure exemption is not a Cortex Markdown file: ${args.entry}`;
  }
  if (args.baseline !== false && !args.baseline.has(args.entry)) {
    return `Article-structure exemption was added after the baseline: ${args.entry}`;
  }
  return false;
}

function auditDocument(args: AuditDocumentArgs): void {
  const headings = args.document.root.children.filter(isHeading);
  const mapHeading =
    headings.find(
      (heading) => heading.depth === 2 && nodeText(heading) === 'Document map',
    ) ?? false;
  if (mapHeading === false) {
    return;
  }
  const mapIndex = args.document.root.children.indexOf(mapHeading);
  const contentStartArgs: FindContentStartArgs = {
    children: args.document.root.children,
    mapIndex,
  };
  const contentStart = findContentStart(contentStartArgs);
  if (contentStart < 0) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexArticleFindingCode.EmptyArticle,
      file: args.document.relativePath,
      line: nodeLine(mapHeading),
      message: 'Document has no content articles after its Document map.',
    };
    addFinding(findingArgs);
    return;
  }

  const children = args.document.root.children;
  for (let index = contentStart; index < children.length; index += 1) {
    const node = children[index] ?? false;
    if (node === false || node.type !== 'heading') {
      continue;
    }
    const sectionNodeArgs: OwnedSectionNodesArgs = {
      children,
      headingIndex: index,
    };
    const sectionNodes = ownedSectionNodes(sectionNodeArgs);
    const articleArgs: AuditArticleArgs = {
      document: args.document,
      findings: args.findings,
      heading: node,
      sectionNodes,
    };
    auditArticle(articleArgs);
  }
}

type FindContentStartArgs = {
  readonly children: readonly RootContent[];
  readonly mapIndex: number;
};

function findContentStart(args: FindContentStartArgs): number {
  for (
    let index = args.mapIndex + 1;
    index < args.children.length;
    index += 1
  ) {
    const node = args.children[index];
    if (node?.type === 'heading' && node.depth === 2) {
      return index;
    }
  }
  return -1;
}

type OwnedSectionNodesArgs = {
  readonly children: readonly RootContent[];
  readonly headingIndex: number;
};

function ownedSectionNodes(
  args: OwnedSectionNodesArgs,
): readonly RootContent[] {
  const heading = args.children[args.headingIndex] ?? false;
  if (heading === false || heading.type !== 'heading') {
    return [];
  }
  let end = args.children.length;
  for (
    let index = args.headingIndex + 1;
    index < args.children.length;
    index += 1
  ) {
    const node = args.children[index];
    if (node?.type === 'heading' && node.depth <= heading.depth) {
      end = index;
      break;
    }
  }
  return args.children.slice(args.headingIndex + 1, end);
}

function auditArticle(args: AuditArticleArgs): void {
  if (!args.sectionNodes.some(isVisibleArticleNode)) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexArticleFindingCode.EmptyArticle,
      file: args.document.relativePath,
      line: nodeLine(args.heading),
      message: `Article #${nodeText(args.heading)} has no body content.`,
    };
    addFinding(findingArgs);
    return;
  }

  auditConsecutiveParagraphs(args);
  auditProcedure(args);
}

function isVisibleArticleNode(node: RootContent): boolean {
  return (
    node.type !== 'heading' &&
    node.type !== 'definition' &&
    !isInvisibleHtmlComment(node)
  );
}

function auditConsecutiveParagraphs(args: AuditArticleArgs): void {
  let consecutive = 0;
  for (const node of args.sectionNodes) {
    if (node.type === 'heading') {
      break;
    }
    if (isInvisibleHtmlComment(node)) {
      continue;
    }
    if (node.type !== 'paragraph') {
      consecutive = 0;
      continue;
    }
    consecutive += 1;
    if (consecutive === MAX_CONSECUTIVE_PARAGRAPHS + 1) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexArticleFindingCode.DenseArticle,
        file: args.document.relativePath,
        line: nodeLine(node),
        message: `Article #${nodeText(args.heading)} has more than ${MAX_CONSECUTIVE_PARAGRAPHS} consecutive prose blocks without visible structure.`,
      };
      addFinding(findingArgs);
    }
  }
}

function isInvisibleHtmlComment(node: RootContent): boolean {
  return node.type === 'html' && /^\s*<!--[\s\S]*-->\s*$/.test(node.value);
}

function auditProcedure(args: AuditArticleArgs): void {
  if (!PROCEDURE_HEADING.test(nodeText(args.heading))) {
    return;
  }
  const hasOrderedList = args.sectionNodes.some(
    (node) => node.type === 'list' && node.ordered === true,
  );
  if (hasOrderedList) {
    return;
  }
  const findingArgs: AddFindingArgs = {
    findings: args.findings,
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: args.document.relativePath,
    line: nodeLine(args.heading),
    message: `Procedure-like article #${nodeText(args.heading)} must expose its action sequence as an ordered list.`,
  };
  addFinding(findingArgs);
}

function isHeading(node: RootContent): node is Heading {
  return node.type === 'heading';
}

function nodeText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }
  if (!('children' in node)) {
    return '';
  }
  return node.children.map((child) => nodeText(child as RootContent)).join('');
}

function nodeLine(node: RootContent): number {
  return node.position?.start.line ?? 1;
}

function addFinding(args: AddFindingArgs): void {
  const finding: CortexArticleFinding = {
    code: args.code,
    file: args.file,
    line: args.line,
    message: args.message,
  };
  args.findings.push(finding);
}
