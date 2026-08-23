import {
  CortexArticleFindingCode,
  type AuditCortexArticleStructureRequest,
  type CortexArticleBlock,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleHeadingBlock,
} from './domain.ts';

type ParsedArticleDocument = CortexArticleDocument & {
  readonly root: { readonly children: readonly CortexArticleBlock[] };
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
  readonly migrationLedgerContent: string | false;
  readonly migrationLedgerRelativePath: string;
};

type AuditDocumentArgs = {
  readonly document: ParsedArticleDocument;
  readonly findings: CortexArticleFinding[];
};

type AuditArticleArgs = AuditDocumentArgs & {
  readonly heading: CortexArticleHeadingBlock;
  readonly sectionNodes: readonly CortexArticleBlock[];
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;

export function auditCortexArticleStructure(
  request: AuditCortexArticleStructureRequest,
): CortexArticleFinding[] {
  const findings: CortexArticleFinding[] = [];
  const documents = request.documents.map(parseDocument);
  const catalog = new Set(documents.map((document) => document.relativePath));
  const exemptionArgs: ReadMigrationExemptionsArgs = {
    catalog,
    findings,
    migrationBaselineEntries: request.migrationBaselineEntries,
    migrationLedgerContent: request.migrationLedger.content,
    migrationLedgerRelativePath: request.migrationLedger.relativePath,
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

function parseDocument(document: CortexArticleDocument): ParsedArticleDocument {
  const root = { children: document.blocks };
  return { ...document, root };
}

function readMigrationExemptions(
  args: ReadMigrationExemptionsArgs,
): ReadonlySet<string> {
  if (args.migrationLedgerContent === false) {
    return new Set<string>();
  }

  const exemptions = new Set<string>();
  const baseline =
    args.migrationBaselineEntries === false
      ? false
      : new Set(args.migrationBaselineEntries);
  const ledgerFile = args.migrationLedgerRelativePath;
  const lines = args.migrationLedgerContent.split(/\r?\n/);

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
    return 'Duplicate article-structure migration exemption.';
  }
  if (!args.catalog.has(args.entry)) {
    return 'Article-structure exemption is not a Cortex Markdown file.';
  }
  if (args.baseline !== false && !args.baseline.has(args.entry)) {
    return 'Article-structure exemption was added after the baseline.';
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
  readonly children: readonly CortexArticleBlock[];
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
  readonly children: readonly CortexArticleBlock[];
  readonly headingIndex: number;
};

function ownedSectionNodes(
  args: OwnedSectionNodesArgs,
): readonly CortexArticleBlock[] {
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
      message: 'Article has no body content.',
    };
    addFinding(findingArgs);
    return;
  }

  auditConsecutiveParagraphs(args);
  auditProcedure(args);
}

function isVisibleArticleNode(node: CortexArticleBlock): boolean {
  return node.type !== 'heading' && !isTransparentArticleNode(node);
}

function auditConsecutiveParagraphs(args: AuditArticleArgs): void {
  let consecutive = 0;
  for (const node of args.sectionNodes) {
    if (node.type === 'heading') {
      break;
    }
    if (isTransparentArticleNode(node)) {
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
        message: `Article has more than ${MAX_CONSECUTIVE_PARAGRAPHS} consecutive prose blocks without visible structure.`,
      };
      addFinding(findingArgs);
    }
  }
}

function isTransparentArticleNode(node: CortexArticleBlock): boolean {
  return node.type === 'definition' || isInvisibleHtmlComment(node);
}

function isInvisibleHtmlComment(node: CortexArticleBlock): boolean {
  return node.type === 'html' && node.comment;
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
    message:
      'Procedure-like article must expose its action sequence as an ordered list.',
  };
  addFinding(findingArgs);
}

function isHeading(
  node: CortexArticleBlock,
): node is CortexArticleHeadingBlock {
  return node.type === 'heading';
}

function nodeText(node: CortexArticleBlock): string {
  return node.type === 'heading' ? node.text : '';
}

function nodeLine(node: CortexArticleBlock): number {
  return node.line;
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
