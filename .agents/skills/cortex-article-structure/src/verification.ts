import {
  CortexArticleFindingCode,
  CortexArticleFindingMessage,
  type AuditCortexArticleStructureRequest,
  type CortexArticleBlock,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleHeadingBlock,
  type CortexArticleStructureResult,
} from './domain.ts';

type VerifyCortexArticleStructureResultRequest = {
  readonly auditRequest: AuditCortexArticleStructureRequest;
  readonly result: CortexArticleStructureResult;
};

type VerifiedDocument = CortexArticleDocument & {
  readonly root: { readonly children: readonly CortexArticleBlock[] };
};

type VerifyDocumentRequest = {
  readonly document: VerifiedDocument;
  readonly expected: CortexArticleFinding[];
};

type VerifyArticleRequest = VerifyDocumentRequest & {
  readonly heading: CortexArticleHeadingBlock;
  readonly nodes: readonly CortexArticleBlock[];
};

const MAX_CONSECUTIVE_PARAGRAPHS = 3;
const PROCEDURE_HEADING =
  /\b(procedures?|runbooks?|steps|ordered deliver(?:y|ies)|delivery sequences?)\b/i;

export function verifyCortexArticleStructureResult(
  request: VerifyCortexArticleStructureResultRequest,
): void {
  const expected = independentlyDeriveExpectedFindings(request.auditRequest);
  if (request.result.findings.length !== expected.length) {
    throw new Error('Cortex article-structure semantic verification failed.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actualFinding = request.result.findings.at(index);
    const expectedFinding = expected.at(index);
    if (
      !actualFinding ||
      !expectedFinding ||
      actualFinding.code !== expectedFinding.code ||
      actualFinding.file !== expectedFinding.file ||
      actualFinding.line !== expectedFinding.line ||
      actualFinding.message !== expectedFinding.message
    ) {
      throw new Error('Cortex article-structure semantic verification failed.');
    }
  }
}

function independentlyDeriveExpectedFindings(
  request: AuditCortexArticleStructureRequest,
): CortexArticleFinding[] {
  const expected: CortexArticleFinding[] = [];
  const documents = request.documents.map(parseDocument);
  const catalog = new Set(documents.map((document) => document.relativePath));
  const ledgerRequest: VerifyMigrationLedgerRequest = {
    baselineEntries: request.migrationBaselineEntries,
    catalog,
    expected,
    ledgerContent: request.migrationLedger.content,
    ledgerPath: request.migrationLedger.relativePath,
  };
  const exemptions = verifyMigrationLedger(ledgerRequest);
  for (const document of documents) {
    if (exemptions.has(document.relativePath)) continue;
    const documentRequest: VerifyDocumentRequest = { document, expected };
    verifyDocument(documentRequest);
  }
  return expected;
}

type VerifyMigrationLedgerRequest = {
  readonly baselineEntries: readonly string[] | false;
  readonly catalog: ReadonlySet<string>;
  readonly expected: CortexArticleFinding[];
  readonly ledgerContent: string | false;
  readonly ledgerPath: string;
};

function verifyMigrationLedger(
  request: VerifyMigrationLedgerRequest,
): ReadonlySet<string> {
  const exemptions = new Set<string>();
  if (request.ledgerContent === false) return exemptions;
  const baseline =
    request.baselineEntries === false
      ? false
      : new Set(request.baselineEntries);
  const lines = request.ledgerContent.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const entry = (lines.at(index) ?? '').trim();
    if (entry.length === 0 || entry.startsWith('#')) continue;
    let message: string | false = false;
    if (exemptions.has(entry)) {
      message = CortexArticleFindingMessage.DuplicateMigrationEntry;
    } else if (!request.catalog.has(entry)) {
      message = CortexArticleFindingMessage.UncatalogedMigrationEntry;
    } else if (baseline !== false && !baseline.has(entry)) {
      message = CortexArticleFindingMessage.PostBaselineMigrationEntry;
    }
    if (message !== false) {
      const finding: CortexArticleFinding = {
        code: CortexArticleFindingCode.InvalidMigrationLedger,
        file: request.ledgerPath,
        line: index + 1,
        message,
      };
      request.expected.push(finding);
      continue;
    }
    exemptions.add(entry);
  }
  return exemptions;
}

function parseDocument(document: CortexArticleDocument): VerifiedDocument {
  const root = { children: document.blocks };
  return { ...document, root };
}

function verifyDocument(request: VerifyDocumentRequest): void {
  const children = request.document.root.children;
  for (let index = 0; index < children.length; index += 1) {
    const heading = children.at(index);
    if (
      !heading ||
      heading.type !== 'heading' ||
      (heading.depth !== 2 && heading.depth !== 3)
    ) {
      continue;
    }
    const nodesRequest: OwnedArticleNodesRequest = {
      children,
      headingIndex: index,
    };
    const articleRequest: VerifyArticleRequest = {
      ...request,
      heading,
      nodes: ownedArticleNodes(nodesRequest),
    };
    verifyArticle(articleRequest);
  }
}

type OwnedArticleNodesRequest = {
  readonly children: readonly CortexArticleBlock[];
  readonly headingIndex: number;
};

function ownedArticleNodes(
  request: OwnedArticleNodesRequest,
): readonly CortexArticleBlock[] {
  if (!Number.isSafeInteger(request.headingIndex) || request.headingIndex < 0) {
    return [];
  }
  const heading = request.children.at(request.headingIndex);
  if (!heading || heading.type !== 'heading') return [];
  let end = request.children.length;
  for (let index = request.headingIndex + 1; index < end; index += 1) {
    const node = request.children.at(index);
    if (node?.type === 'heading' && node.depth <= heading.depth) {
      end = index;
      break;
    }
  }
  return request.children.slice(request.headingIndex + 1, end);
}

function verifyArticle(request: VerifyArticleRequest): void {
  if (!request.nodes.some(isVisibleNode)) {
    const finding: CortexArticleFinding = {
      code: CortexArticleFindingCode.EmptyArticle,
      file: request.document.relativePath,
      line: nodeLine(request.heading),
      message: CortexArticleFindingMessage.EmptyArticle,
    };
    request.expected.push(finding);
    return;
  }
  let consecutiveParagraphs = 0;
  for (const node of request.nodes) {
    if (node.type === 'heading') break;
    if (isTransparentNode(node)) continue;
    consecutiveParagraphs =
      node.type === 'paragraph' ? consecutiveParagraphs + 1 : 0;
    if (consecutiveParagraphs === MAX_CONSECUTIVE_PARAGRAPHS + 1) {
      const finding: CortexArticleFinding = {
        code: CortexArticleFindingCode.DenseArticle,
        file: request.document.relativePath,
        line: nodeLine(node),
        message: CortexArticleFindingMessage.DenseArticle,
      };
      request.expected.push(finding);
    }
  }
  if (
    PROCEDURE_HEADING.test(nodeText(request.heading)) &&
    !request.nodes.some((node) => node.type === 'list' && node.ordered === true)
  ) {
    const finding: CortexArticleFinding = {
      code: CortexArticleFindingCode.UnorderedProcedure,
      file: request.document.relativePath,
      line: nodeLine(request.heading),
      message: CortexArticleFindingMessage.UnorderedProcedure,
    };
    request.expected.push(finding);
  }
}

function isVisibleNode(node: CortexArticleBlock): boolean {
  return (
    node.type !== 'heading' &&
    node.type !== 'separator' &&
    !isTransparentNode(node)
  );
}

function isTransparentNode(node: CortexArticleBlock): boolean {
  return node.type === 'definition' || (node.type === 'html' && node.comment);
}

function nodeText(node: CortexArticleBlock): string {
  return node.type === 'heading' ? node.text : '';
}

function nodeLine(node: CortexArticleBlock): number {
  return node.line;
}
