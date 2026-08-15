import { readFileSync } from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type {
  Heading,
  Link,
  List,
  ListItem,
  Parent,
  Root,
  RootContent,
} from 'mdast';

export enum CortexStructureFindingCode {
  InvalidMigrationLedger = 'invalid-migration-ledger',
  InvalidTitle = 'invalid-title',
  MissingRelationships = 'missing-relationships',
  MissingDocumentMap = 'missing-document-map',
  InvalidRelationship = 'invalid-relationship',
  InvalidMapEntry = 'invalid-map-entry',
  BrokenFragment = 'broken-fragment',
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
};

type NavigationEntry = {
  readonly url: string;
  readonly depth: number;
  readonly line: number;
  readonly explanationCount: number;
};

type ExpectedMapEntry = {
  readonly fragment: string;
  readonly depth: number;
  readonly line: number;
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
  readonly catalog: ReadonlyMap<string, ParsedDocument>;
  readonly findings: CortexStructureFinding[];
  readonly repoRoot: string;
};

type ValidateNavigationEntriesArgs = {
  readonly entries: readonly NavigationEntry[];
  readonly file: string;
  readonly findings: CortexStructureFinding[];
  readonly kind: 'relationship' | 'map';
};

type ResolveRelationshipArgs = {
  readonly document: ParsedDocument;
  readonly url: string;
  readonly repoRoot: string;
};

type ResolvedRelationship = {
  readonly targetPath: string;
  readonly fragment: string | false;
};

export function auditCortexDocumentStructure(
  args: AuditCortexDocumentStructureArgs,
): CortexStructureFinding[] {
  const findings: CortexStructureFinding[] = [];
  const parsedDocuments = args.documents.map(parseDocument);
  const catalog = new Map(
    parsedDocuments.map((document) => [document.relativePath, document]),
  );
  const exemptionArgs: ReadMigrationExemptionsArgs = {
    catalog,
    findings,
    migrationBaselineEntries: args.migrationBaselineEntries,
    migrationLedgerPath: args.migrationLedgerPath,
    repoRoot: args.repoRoot,
  };
  const exemptions = readMigrationExemptions(exemptionArgs);

  for (const document of parsedDocuments) {
    if (exemptions.has(document.relativePath)) {
      continue;
    }
    const validateArgs: ValidateDocumentArgs = {
      document,
      catalog,
      findings,
      repoRoot: args.repoRoot,
    };
    validateDocument(validateArgs);
  }
  return findings;
}

type ReadMigrationExemptionsArgs = {
  readonly catalog: ReadonlyMap<string, ParsedDocument>;
  readonly findings: CortexStructureFinding[];
  readonly migrationBaselineEntries: readonly string[] | false;
  readonly migrationLedgerPath: string;
  readonly repoRoot: string;
};

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
    if (
      exemptions.has(entry) ||
      !args.catalog.has(entry) ||
      (baseline !== false && !baseline.has(entry))
    ) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidMigrationLedger,
        file: ledgerFile,
        line: index + 1,
        message: exemptions.has(entry)
          ? `Duplicate migration exemption: ${entry}`
          : !args.catalog.has(entry)
            ? `Migration exemption does not name a Cortex Markdown file: ${entry}`
            : `Migration exemption was added after the baseline: ${entry}`,
      };
      addFinding(findingArgs);
      continue;
    }
    exemptions.add(entry);
  }
  return exemptions;
}

function parseDocument(document: CortexDocumentSource): ParsedDocument {
  const root = fromMarkdown(document.content);
  const slugger = new GithubSlugger();
  const fragments = new Set<string>();
  for (const node of root.children) {
    if (node.type === 'heading') {
      const headingText = nodeText(node);
      fragments.add(slugger.slug(headingText));
    }
  }
  return { ...document, root, fragments };
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
      line: nodeLine(h1s[0]),
      message: 'Document must begin with exactly one H1 title.',
    };
    addFinding(findingArgs);
  }

  const rootH2s = headings.filter((heading) => heading.depth === 2);
  const relationshipsHeading = rootH2s[0];
  const mapHeading = rootH2s[1];
  if (nodeTextOrEmpty(relationshipsHeading) !== 'Relationships') {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.MissingRelationships,
      file: args.document.relativePath,
      line: nodeLine(relationshipsHeading),
      message: 'The first H2 must be `Relationships`.',
    };
    addFinding(findingArgs);
  }
  if (nodeTextOrEmpty(mapHeading) !== 'Document map') {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.MissingDocumentMap,
      file: args.document.relativePath,
      line: nodeLine(mapHeading),
      message: 'The second H2 must be `Document map`.',
    };
    addFinding(findingArgs);
  }
  if (
    relationshipsHeading === undefined ||
    mapHeading === undefined ||
    nodeTextOrEmpty(relationshipsHeading) !== 'Relationships' ||
    nodeTextOrEmpty(mapHeading) !== 'Document map'
  ) {
    return;
  }

  const relationshipSectionArgs: SectionNodesArgs = {
    children: args.document.root.children,
    heading: relationshipsHeading,
  };
  const relationshipNodes = sectionNodes(relationshipSectionArgs);
  const relationshipArgs: ValidateRelationshipsArgs = {
    ...args,
    nodes: relationshipNodes,
  };
  validateRelationships(relationshipArgs);

  const mapSectionArgs: SectionNodesArgs = {
    children: args.document.root.children,
    heading: mapHeading,
  };
  const mapNodes = sectionNodes(mapSectionArgs);
  const mapArgs: ValidateMapArgs = { ...args, mapHeading, mapNodes };
  validateMap(mapArgs);
}

type SectionNodesArgs = {
  readonly children: readonly RootContent[];
  readonly heading: Heading;
};

function sectionNodes(args: SectionNodesArgs): readonly RootContent[] {
  const start = args.children.indexOf(args.heading) + 1;
  let end = args.children.length;
  for (let index = start; index < args.children.length; index += 1) {
    const node = args.children[index];
    if (node?.type === 'heading' && node.depth === 2) {
      end = index;
      break;
    }
  }
  return args.children.slice(start, end);
}

type ValidateRelationshipsArgs = ValidateDocumentArgs & {
  readonly nodes: readonly RootContent[];
};

function validateRelationships(args: ValidateRelationshipsArgs): void {
  const entries = navigationEntries(args.nodes);
  const containsExplicitNone = args.nodes.some(
    (node) =>
      node.type === 'list' &&
      node.children.some((item) => nodeText(item).trim() === 'None.'),
  );
  if (containsExplicitNone && entries.length > 0) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.InvalidRelationship,
      file: args.document.relativePath,
      line: nodeLine(args.nodes[0]),
      message: '`None.` cannot appear alongside linked relationships.',
    };
    addFinding(findingArgs);
  }
  if (entries.length === 0 && !containsExplicitNone) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.InvalidRelationship,
      file: args.document.relativePath,
      line: nodeLine(args.nodes[0]),
      message:
        'Relationships must contain linked entries or an explicit `None.` item.',
    };
    addFinding(findingArgs);
    return;
  }
  const navigationArgs: ValidateNavigationEntriesArgs = {
    entries,
    file: args.document.relativePath,
    findings: args.findings,
    kind: 'relationship',
  };
  validateNavigationEntries(navigationArgs);
  const seen = new Set<string>();
  for (const entry of entries) {
    const resolveArgs: ResolveRelationshipArgs = {
      document: args.document,
      url: entry.url,
      repoRoot: args.repoRoot,
    };
    const resolved = resolveRelationship(resolveArgs);
    if (resolved === false) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidRelationship,
        file: args.document.relativePath,
        line: entry.line,
        message: `Relationship must target a Markdown document inside .cortex: ${entry.url}`,
      };
      addFinding(findingArgs);
      continue;
    }
    if (
      resolved.targetPath === args.document.relativePath ||
      seen.has(resolved.targetPath)
    ) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidRelationship,
        file: args.document.relativePath,
        line: entry.line,
        message:
          resolved.targetPath === args.document.relativePath
            ? 'Relationship must not target its own document.'
            : `Duplicate relationship target: ${resolved.targetPath}`,
      };
      addFinding(findingArgs);
      continue;
    }
    seen.add(resolved.targetPath);
    const fragmentArgs: ValidateResolvedFragmentArgs = {
      catalog: args.catalog,
      file: args.document.relativePath,
      findings: args.findings,
      fragment: resolved.fragment,
      line: entry.line,
      targetPath: resolved.targetPath,
    };
    validateResolvedFragment(fragmentArgs);
  }
}

type ValidateMapArgs = ValidateDocumentArgs & {
  readonly mapHeading: Heading;
  readonly mapNodes: readonly RootContent[];
};

function validateMap(args: ValidateMapArgs): void {
  const entries = navigationEntries(args.mapNodes);
  const navigationArgs: ValidateNavigationEntriesArgs = {
    entries,
    file: args.document.relativePath,
    findings: args.findings,
    kind: 'map',
  };
  validateNavigationEntries(navigationArgs);
  const expectedArgs: ExpectedMapEntriesArgs = {
    children: args.document.root.children,
    mapHeading: args.mapHeading,
  };
  const expected = expectedMapEntries(expectedArgs);
  if (entries.length !== expected.length) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.InvalidMapEntry,
      file: args.document.relativePath,
      line: nodeLine(args.mapHeading),
      message: `Document map has ${entries.length} entries but must cover ${expected.length} content headings.`,
    };
    addFinding(findingArgs);
  }
  const count = Math.max(entries.length, expected.length);
  for (let index = 0; index < count; index += 1) {
    const actual = entries[index];
    const wanted = expected[index];
    if (actual === undefined || wanted === undefined) {
      continue;
    }
    const actualFragment = decodeFragment(actual.url);
    if (actualFragment !== wanted.fragment || actual.depth !== wanted.depth) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidMapEntry,
        file: args.document.relativePath,
        line: actual.line,
        message: `Expected map entry #${wanted.fragment} at nesting depth ${wanted.depth}.`,
      };
      addFinding(findingArgs);
    }
  }
}

type ExpectedMapEntriesArgs = {
  readonly children: readonly RootContent[];
  readonly mapHeading: Heading;
};

function expectedMapEntries(args: ExpectedMapEntriesArgs): ExpectedMapEntry[] {
  const mapIndex = args.children.indexOf(args.mapHeading);
  let contentStart = args.children.length;
  for (let index = mapIndex + 1; index < args.children.length; index += 1) {
    const node = args.children[index];
    if (node?.type === 'heading' && node.depth === 2) {
      contentStart = index;
      break;
    }
  }
  const slugger = new GithubSlugger();
  for (let index = 0; index < contentStart; index += 1) {
    const node = args.children[index];
    if (node?.type === 'heading') {
      slugger.slug(nodeText(node));
    }
  }
  const entries: ExpectedMapEntry[] = [];
  const depthStack: number[] = [];
  for (const node of args.children.slice(contentStart)) {
    if (node.type !== 'heading') {
      continue;
    }
    while (depthStack.length > 0 && (depthStack.at(-1) ?? 0) >= node.depth) {
      depthStack.pop();
    }
    depthStack.push(node.depth);
    const entry: ExpectedMapEntry = {
      fragment: slugger.slug(nodeText(node)),
      depth: depthStack.length - 1,
      line: nodeLine(node),
    };
    entries.push(entry);
  }
  return entries;
}

function navigationEntries(nodes: readonly RootContent[]): NavigationEntry[] {
  const entries: NavigationEntry[] = [];
  for (const node of nodes) {
    if (node.type === 'list') {
      const collectArgs: CollectNavigationEntriesArgs = {
        depth: 0,
        entries,
        list: node,
      };
      collectNavigationEntries(collectArgs);
    }
  }
  return entries;
}

type CollectNavigationEntriesArgs = {
  readonly depth: number;
  readonly entries: NavigationEntry[];
  readonly list: List;
};

function collectNavigationEntries(args: CollectNavigationEntriesArgs): void {
  for (const item of args.list.children) {
    const primaryLink = itemPrimaryLink(item);
    if (primaryLink === false) {
      continue;
    }
    let explanationCount = 0;
    const nestedLists = item.children.filter(
      (child): child is List => child.type === 'list',
    );
    for (const child of nestedLists) {
      for (const nestedItem of child.children) {
        if (itemPrimaryLink(nestedItem) === false) {
          explanationCount += 1;
        }
      }
    }
    const entry: NavigationEntry = {
      url: primaryLink.url,
      depth: args.depth,
      line: nodeLine(primaryLink),
      explanationCount,
    };
    args.entries.push(entry);
    for (const child of nestedLists) {
      const nestedArgs: CollectNavigationEntriesArgs = {
        depth: args.depth + 1,
        entries: args.entries,
        list: child,
      };
      collectNavigationEntries(nestedArgs);
    }
  }
}

function itemPrimaryLink(item: ListItem): Link | false {
  const paragraph = item.children.find((child) => child.type === 'paragraph');
  if (paragraph?.type !== 'paragraph') {
    return false;
  }
  return findFirstLink(paragraph);
}

function findFirstLink(parent: Parent): Link | false {
  for (const child of parent.children) {
    if (child.type === 'link') {
      return child;
    }
    if ('children' in child) {
      const nested = findFirstLink(child);
      if (nested !== false) {
        return nested;
      }
    }
  }
  return false;
}

function validateNavigationEntries(args: ValidateNavigationEntriesArgs): void {
  for (const entry of args.entries) {
    if (entry.explanationCount !== 2) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code:
          args.kind === 'map'
            ? CortexStructureFindingCode.InvalidMapEntry
            : CortexStructureFindingCode.InvalidRelationship,
        file: args.file,
        line: entry.line,
        message: `${capitalize(args.kind)} entry must have exactly two concise explanation bullets.`,
      };
      addFinding(findingArgs);
    }
    if (args.kind === 'map' && !entry.url.startsWith('#')) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidMapEntry,
        file: args.file,
        line: entry.line,
        message: `Document-map entry must use a same-document fragment: ${entry.url}`,
      };
      addFinding(findingArgs);
    }
  }
}

function resolveRelationship(
  args: ResolveRelationshipArgs,
): ResolvedRelationship | false {
  const hashIndex = args.url.indexOf('#');
  const rawPath = hashIndex === -1 ? args.url : args.url.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? false : args.url.slice(hashIndex + 1);
  if (
    rawPath.length === 0 ||
    !rawPath.endsWith('.md') ||
    rawPath.includes('://')
  ) {
    return false;
  }
  const targetAbsolute = path.resolve(
    path.dirname(args.document.absolutePath),
    decodeURIComponent(rawPath),
  );
  const cortexRoot = path.resolve(args.repoRoot, '.cortex');
  if (!targetAbsolute.startsWith(`${cortexRoot}${path.sep}`)) {
    return false;
  }
  return {
    targetPath: path.relative(args.repoRoot, targetAbsolute),
    fragment: rawFragment === false ? false : decodeURIComponent(rawFragment),
  };
}

type ValidateResolvedFragmentArgs = {
  readonly catalog: ReadonlyMap<string, ParsedDocument>;
  readonly file: string;
  readonly findings: CortexStructureFinding[];
  readonly fragment: string | false;
  readonly line: number;
  readonly targetPath: string;
};

function validateResolvedFragment(args: ValidateResolvedFragmentArgs): void {
  const target = args.catalog.get(args.targetPath);
  if (target === undefined) {
    return;
  }
  if (args.fragment !== false && !target.fragments.has(args.fragment)) {
    const findingArgs: AddFindingArgs = {
      findings: args.findings,
      code: CortexStructureFindingCode.BrokenFragment,
      file: args.file,
      line: args.line,
      message: `Missing fragment #${args.fragment} in ${args.targetPath}.`,
    };
    addFinding(findingArgs);
  }
}

function decodeFragment(url: string): string {
  return url.startsWith('#') ? decodeURIComponent(url.slice(1)) : url;
}

function isHeading(node: RootContent): node is Heading {
  return node.type === 'heading';
}

function nodeText(node: Parent): string {
  let text = '';
  for (const child of node.children) {
    if ('value' in child && typeof child.value === 'string') {
      text += child.value;
    } else if ('children' in child) {
      text += nodeText(child);
    }
  }
  return text;
}

function nodeTextOrEmpty(node: Heading | undefined): string {
  return node === undefined ? '' : nodeText(node);
}

function nodeLine(node: RootContent | Heading | Link | undefined): number {
  return node?.position?.start.line ?? 1;
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

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
