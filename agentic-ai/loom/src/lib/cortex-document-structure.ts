import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Heading, Link, Parent, Root, RootContent } from 'mdast';

export enum CortexStructureFindingCode {
  InvalidMigrationLedger = 'invalid-migration-ledger',
  InvalidTitle = 'invalid-title',
  ProhibitedNavigation = 'prohibited-navigation',
  MissingIndex = 'missing-index',
  InvalidIndexEntry = 'invalid-index-entry',
  BrokenFragment = 'broken-fragment',
  MissingFromIndex = 'missing-from-index',
  MissingRelationships = 'missing-relationships',
  MissingDocumentMap = 'missing-document-map',
  InvalidRelationship = 'invalid-relationship',
  InvalidMapEntry = 'invalid-map-entry',
}

export type CortexStructureFinding = {
  readonly code: CortexStructureFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type CortexDocumentSource = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly content: string;
};

export type AuditCortexDocumentStructureArgs = {
  readonly documents: readonly CortexDocumentSource[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerPath: string;
  readonly repoRoot: string;
};

type ParsedDocument = CortexDocumentSource & {
  readonly root: Root;
  readonly fragments: ReadonlySet<string>;
  readonly headingSlugs: readonly string[];
};

type AddFindingArgs = {
  readonly findings: CortexStructureFinding[];
  readonly code: CortexStructureFindingCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

type ValidateDocumentArgs = {
  readonly document: ParsedDocument;
  readonly findings: CortexStructureFinding[];
};

type ValidateIndexArgs = {
  readonly indexDocument: ParsedDocument;
  readonly catalog: ReadonlyMap<string, ParsedDocument>;
  readonly findings: CortexStructureFinding[];
  readonly repoRoot: string;
};

type ResolveIndexLinkArgs = {
  readonly url: string;
  readonly indexRelativePath: string;
};

type ResolvedIndexLink = {
  readonly targetRelativePath: string;
  readonly fragment: string | false;
};

export function auditCortexDocumentStructure(
  args: AuditCortexDocumentStructureArgs,
): CortexStructureFinding[] {
  const findings: CortexStructureFinding[] = [];
  const parsedDocuments = args.documents.map(parseDocument);
  const catalog = new Map(
    parsedDocuments.map((document) => [
      normalizeCortexRelativePath(document.relativePath),
      document,
    ]),
  );

  const indexDoc =
    catalog.get('.cortex/knowledge-graph.md') ??
    catalog.get('knowledge-graph.md') ??
    catalog.get('.cortex/k-graph.md') ??
    catalog.get('k-graph.md') ??
    catalog.get('.cortex/INDEX.md') ??
    catalog.get('INDEX.md') ??
    false;

  if (indexDoc === false) {
    const findingArgs: AddFindingArgs = {
      findings,
      code: CortexStructureFindingCode.MissingIndex,
      file: '.cortex/knowledge-graph.md',
      line: 1,
      message:
        'Centralized Cortex knowledge graph `.cortex/knowledge-graph.md` is missing.',
    };
    addFinding(findingArgs);
  } else {
    const validateIndexArgs: ValidateIndexArgs = {
      indexDocument: indexDoc,
      catalog,
      findings,
      repoRoot: args.repoRoot,
    };
    validateIndex(validateIndexArgs);
  }

  for (const document of parsedDocuments) {
    const normPath = normalizeCortexRelativePath(document.relativePath);
    if (
      normPath === '.cortex/knowledge-graph.md' ||
      normPath === 'knowledge-graph.md' ||
      normPath === '.cortex/k-graph.md' ||
      normPath === 'k-graph.md' ||
      normPath === '.cortex/INDEX.md' ||
      normPath === 'INDEX.md'
    ) {
      continue;
    }
    const validateArgs: ValidateDocumentArgs = {
      document,
      findings,
    };
    validateDocument(validateArgs);
  }

  return findings;
}

function normalizeCortexRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('.cortex/')) {
    return normalized;
  }
  if (normalized.startsWith('./.cortex/')) {
    return normalized.slice(2);
  }
  return `.cortex/${normalized}`;
}

function parseDocument(document: CortexDocumentSource): ParsedDocument {
  const root = fromMarkdown(document.content);
  const slugger = new GithubSlugger();
  const fragments = new Set<string>();
  const headingSlugs: string[] = [];
  for (const node of root.children) {
    if (node.type === 'heading') {
      const headingText = nodeText(node);
      const slug = slugger.slug(headingText);
      fragments.add(slug);
      headingSlugs.push(slug);
    }
  }
  return { ...document, root, fragments, headingSlugs };
}

function validateDocument(args: ValidateDocumentArgs): void {
  const headings = args.document.root.children.filter(isHeading);
  const h1s = headings.filter((heading) => heading.depth === 1);
  const firstNode = args.document.root.children[0];

  if (h1s.length !== 1 || firstNode !== h1s[0]) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.InvalidTitle,
      file: args.document.relativePath,
      line: nodeLine(h1s[0] ?? false),
      message: 'Document must begin with exactly one H1 title.',
    };
    addFinding(findingArgs);
  }

  // Check for obsolete inline Relationships or Document map
  const rootH2s = headings.filter((heading) => heading.depth === 2);
  for (const h2 of rootH2s) {
    const text = nodeText(h2).trim();
    if (text === 'Relationships' || text === 'Document map') {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.ProhibitedNavigation,
        file: args.document.relativePath,
        line: nodeLine(h2),
        message: `Inline \`## ${text}\` is prohibited; navigation is centralized in \`.cortex/knowledge-graph.md\`.`,
      };
      addFinding(findingArgs);
    }
  }
}

function validateIndex(args: ValidateIndexArgs): void {
  const headings = args.indexDocument.root.children.filter(isHeading);
  const h1s = headings.filter((heading) => heading.depth === 1);
  const firstNode = args.indexDocument.root.children[0];

  if (h1s.length !== 1 || firstNode !== h1s[0]) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.InvalidTitle,
      file: args.indexDocument.relativePath,
      line: nodeLine(h1s[0] ?? false),
      message: 'Knowledge graph must begin with exactly one H1 title.',
    };
    addFinding(findingArgs);
  }

  const allLinks = collectAllLinks(args.indexDocument.root);
  const indexedFiles = new Set<string>();

  for (const link of allLinks) {
    const resolveArgs: ResolveIndexLinkArgs = {
      url: link.url,
      indexRelativePath: args.indexDocument.relativePath,
    };
    const resolved = resolveIndexLink(resolveArgs);
    if (resolved === false) {
      continue;
    }

    const targetDoc = args.catalog.get(resolved.targetRelativePath);
    if (!targetDoc) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidIndexEntry,
        file: args.indexDocument.relativePath,
        line: nodeLine(link),
        message: `Index link points to non-existent document: ${resolved.targetRelativePath}`,
      };
      addFinding(findingArgs);
      continue;
    }

    indexedFiles.add(resolved.targetRelativePath);

    if (resolved.fragment !== false) {
      if (!targetDoc.fragments.has(resolved.fragment)) {
        const findingArgs: AddFindingArgs = {
          findings: args.findings,
          code: CortexStructureFindingCode.BrokenFragment,
          file: args.indexDocument.relativePath,
          line: nodeLine(link),
          message: `Index link points to missing heading fragment #${resolved.fragment} in ${resolved.targetRelativePath}`,
        };
        addFinding(findingArgs);
      }
    }
  }

  // Verify all documents in catalog (except knowledge graph) are present in index
  for (const [normPath] of args.catalog) {
    if (
      normPath === '.cortex/knowledge-graph.md' ||
      normPath === 'knowledge-graph.md' ||
      normPath === '.cortex/k-graph.md' ||
      normPath === 'k-graph.md' ||
      normPath === '.cortex/INDEX.md' ||
      normPath === 'INDEX.md'
    ) {
      continue;
    }
    if (!indexedFiles.has(normPath)) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.MissingFromIndex,
        file: args.indexDocument.relativePath,
        line: 1,
        message: `Document is not indexed in .cortex/knowledge-graph.md: ${normPath}`,
      };
      addFinding(findingArgs);
    }
  }
}

function resolveIndexLink(
  args: ResolveIndexLinkArgs,
): ResolvedIndexLink | false {
  const rawUrl = args.url.trim();
  if (
    rawUrl.startsWith('http://') ||
    rawUrl.startsWith('https://') ||
    rawUrl.startsWith('mailto:')
  ) {
    return false;
  }
  const hashIdx = rawUrl.indexOf('#');
  const pathPart = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx);
  const fragment =
    hashIdx === -1 ? false : decodeURIComponent(rawUrl.slice(hashIdx + 1));

  if (pathPart.length === 0) {
    return false;
  }

  const cleanPath = pathPart.replace(/\\/g, '/');
  const targetRelativePath = normalizeCortexRelativePath(cleanPath);

  return {
    targetRelativePath,
    fragment: fragment && fragment.length > 0 ? fragment : false,
  };
}

function collectAllLinks(root: Root): Link[] {
  const links: Link[] = [];
  function visit(node: RootContent | Parent): void {
    if (node.type === 'link') {
      links.push(node as Link);
    }
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child as RootContent);
      }
    }
  }
  visit(root);
  return links;
}

function isHeading(node: RootContent): node is Heading {
  return node.type === 'heading';
}

function nodeText(node: RootContent | Parent | false): string {
  if (!node) {
    return '';
  }
  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => nodeText(child as RootContent))
      .join('');
  }
  return '';
}

function nodeLine(node: RootContent | Parent | false): number {
  if (!node || !node.position) {
    return 1;
  }
  return node.position.start.line;
}

function addFinding(args: AddFindingArgs): void {
  const finding: CortexStructureFinding = {
    code: args.code,
    file: args.file,
    line: args.line,
    message: args.message,
  };
  args.findings.push(finding);
}
