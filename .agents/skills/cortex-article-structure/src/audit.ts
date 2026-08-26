import {
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleHeading,
  type CortexArticleSemanticBlock,
} from './domain.ts';

type AddFindingRequest = {
  readonly findings: CortexArticleFinding[];
  readonly code: CortexArticleFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

type ReadMigrationExemptionsRequest = {
  readonly catalog: ReadonlySet<string>;
  readonly findings: CortexArticleFinding[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerContent: string | false;
  readonly migrationLedgerRelativePath: string;
};

type AuditDocumentRequest = {
  readonly document: CortexArticleDocument;
  readonly findings: CortexArticleFinding[];
};

type AuditArticleRequest = AuditDocumentRequest & {
  readonly heading: CortexArticleHeading;
  readonly sectionBlocks: readonly CortexArticleSemanticBlock[];
};

type OwnedSectionBlocksRequest = {
  readonly blocks: readonly CortexArticleSemanticBlock[];
  readonly headingIndex: number;
};

type InvalidLedgerMessageRequest = {
  readonly baseline: ReadonlySet<string> | false;
  readonly catalog: ReadonlySet<string>;
  readonly entry: string;
  readonly exemptions: ReadonlySet<string>;
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;

export function auditCortexArticleStructure(
  request: AuditCortexArticleStructureRequest,
): CortexArticleFinding[] {
  const findings: CortexArticleFinding[] = [];
  const catalog = new Set(
    request.documents.map((document) => document.relativePath),
  );
  const exemptionRequest: ReadMigrationExemptionsRequest = {
    catalog,
    findings,
    migrationBaselineEntries: request.migrationBaselineEntries,
    migrationLedgerContent: request.migrationLedger.content,
    migrationLedgerRelativePath: request.migrationLedger.relativePath,
  };
  const exemptions = readMigrationExemptions(exemptionRequest);

  for (const document of request.documents) {
    if (exemptions.has(document.relativePath)) continue;
    const documentRequest: AuditDocumentRequest = { document, findings };
    auditDocument(documentRequest);
  }
  return findings;
}

function readMigrationExemptions(
  request: ReadMigrationExemptionsRequest,
): ReadonlySet<string> {
  if (request.migrationLedgerContent === false) return new Set<string>();
  const exemptions = new Set<string>();
  const baseline =
    request.migrationBaselineEntries === false
      ? false
      : new Set(request.migrationBaselineEntries);
  const lines = request.migrationLedgerContent.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const entry = (lines.at(index) ?? '').trim();
    if (entry.length === 0 || entry.startsWith('#')) continue;
    const messageRequest: InvalidLedgerMessageRequest = {
      baseline,
      catalog: request.catalog,
      entry,
      exemptions,
    };
    const message = invalidLedgerMessage(messageRequest);
    if (message !== false) {
      const findingRequest: AddFindingRequest = {
        findings: request.findings,
        code: CortexArticleFindingCode.InvalidMigrationLedger,
        file: request.migrationLedgerRelativePath,
        line: index + 1,
        message,
      };
      addFinding(findingRequest);
      continue;
    }
    exemptions.add(entry);
  }
  return exemptions;
}

function invalidLedgerMessage(
  request: InvalidLedgerMessageRequest,
): string | false {
  if (request.exemptions.has(request.entry)) {
    return `Duplicate article-structure migration exemption: ${request.entry}`;
  }
  if (!request.catalog.has(request.entry)) {
    return `Article-structure exemption is not a Cortex Markdown file: ${request.entry}`;
  }
  if (request.baseline === false) {
    return `Article-structure exemption cannot be verified without the migration baseline: ${request.entry}`;
  }
  if (!request.baseline.has(request.entry)) {
    return `Article-structure exemption was added after the baseline: ${request.entry}`;
  }
  return false;
}

function auditDocument(request: AuditDocumentRequest): void {
  const { blocks } = request.document;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks.at(index) ?? false;
    if (
      block === false ||
      block.kind !== CortexArticleSemanticKind.Heading ||
      (block.depth !== 2 && block.depth !== 3)
    ) {
      continue;
    }
    const sectionRequest: OwnedSectionBlocksRequest = {
      blocks,
      headingIndex: index,
    };
    const articleRequest: AuditArticleRequest = {
      document: request.document,
      findings: request.findings,
      heading: block,
      sectionBlocks: ownedSectionBlocks(sectionRequest),
    };
    auditArticle(articleRequest);
  }
}

function ownedSectionBlocks(
  request: OwnedSectionBlocksRequest,
): readonly CortexArticleSemanticBlock[] {
  const heading = request.blocks.at(request.headingIndex) ?? false;
  if (heading === false || heading.kind !== CortexArticleSemanticKind.Heading) {
    return [];
  }
  let end = request.blocks.length;
  for (
    let index = request.headingIndex + 1;
    index < request.blocks.length;
    index += 1
  ) {
    const block = request.blocks.at(index);
    if (
      block?.kind === CortexArticleSemanticKind.Heading &&
      block.depth <= heading.depth
    ) {
      end = index;
      break;
    }
  }
  return request.blocks.slice(request.headingIndex + 1, end);
}

function auditArticle(request: AuditArticleRequest): void {
  if (!request.sectionBlocks.some(isVisibleArticleBlock)) {
    const findingRequest: AddFindingRequest = {
      findings: request.findings,
      code: CortexArticleFindingCode.EmptyArticle,
      file: request.document.relativePath,
      line: request.heading.line,
      message: `Article #${request.heading.text} has no body content.`,
    };
    addFinding(findingRequest);
    return;
  }
  auditConsecutiveParagraphs(request);
  auditProcedure(request);
}

function isVisibleArticleBlock(block: CortexArticleSemanticBlock): boolean {
  return (
    block.kind === CortexArticleSemanticKind.Paragraph ||
    block.kind === CortexArticleSemanticKind.VisibleOrderedList ||
    block.kind === CortexArticleSemanticKind.Structure
  );
}

function auditConsecutiveParagraphs(request: AuditArticleRequest): void {
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
    if (block.kind !== CortexArticleSemanticKind.Paragraph) {
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
    addFinding(findingRequest);
  }
}

function auditProcedure(request: AuditArticleRequest): void {
  if (!PROCEDURE_HEADING.test(request.heading.text)) return;
  const hasVisibleOrderedList = request.sectionBlocks.some(
    (block) => block.kind === CortexArticleSemanticKind.VisibleOrderedList,
  );
  if (hasVisibleOrderedList) return;
  const findingRequest: AddFindingRequest = {
    findings: request.findings,
    code: CortexArticleFindingCode.UnorderedProcedure,
    file: request.document.relativePath,
    line: request.heading.line,
    message: `Procedure-like article #${request.heading.text} must expose its action sequence as an ordered list.`,
  };
  addFinding(findingRequest);
}

function addFinding(request: AddFindingRequest): void {
  const finding: CortexArticleFinding = {
    code: request.code,
    file: request.file,
    line: request.line,
    message: request.message,
  };
  request.findings.push(finding);
}
