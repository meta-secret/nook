import path from 'node:path';

// Semantic implementation for the Cortex document-map executable skill.
import GithubSlugger from 'github-slugger';

import { fromMarkdown } from 'mdast-util-from-markdown';

import type { Heading, Link, Parent, Root, RootContent } from 'mdast';

export class CortexDocumentStructure {
  private constructor(
    private readonly request: AuditCortexDocumentStructureArgs,
  ) {}

  static from(args: AuditCortexDocumentStructureArgs): CortexDocumentStructure {
    return new CortexDocumentStructure(args);
  }

  public execute(): CortexStructureFinding[] {
    const args = this.request;
    const findings: CortexStructureFinding[] = [];
    const parsedDocuments = args.documents.map((value) =>
      this.parseDocument(value),
    );
    const catalog = new Map(
      parsedDocuments.map((document) => [
        this.normalizeCortexRelativePath(document.relativePath),
        document,
      ]),
    );

    const [rootIndexDoc = false] = [
      [
        '.cortex/knowledge-graph.md',
        'knowledge-graph.md',
        '.cortex/k-graph.md',
        'k-graph.md',
        '.cortex/INDEX.md',
        'INDEX.md',
      ]
        .map((path) => catalog.get(path))
        .find(Boolean),
    ];

    if (rootIndexDoc === false) {
      const findingArgs: AddFindingArgs = {
        findings,
        code: CortexStructureFindingCode.MissingIndex,
        file: '.cortex/knowledge-graph.md',
        line: 1,
        message:
          'Centralized Cortex knowledge graph `.cortex/knowledge-graph.md` is missing.',
      };
      this.addFinding(findingArgs);
    } else {
      const ownerGraphPaths = [
        '.cortex/gizmo/knowledge-graph.md',
        '.cortex/teams/ai/knowledge-graph.md',
        '.cortex/teams/dev-core/knowledge-graph.md',
        '.cortex/teams/dev-manager/knowledge-graph.md',
        '.cortex/teams/security/knowledge-graph.md',
        '.cortex/teams/sre/knowledge-graph.md',
        '.cortex/teams/web-dev/knowledge-graph.md',
        '.cortex/shared/knowledge-graph.md',
      ] as const;
      const distributedTopology = ownerGraphPaths.some((graphPath) =>
        catalog.has(graphPath),
      );
      const graphDocuments = new Map<string, ParsedDocument>();
      const rootGraphPath = this.normalizeCortexRelativePath(
        rootIndexDoc.relativePath,
      );
      graphDocuments.set(rootGraphPath, rootIndexDoc);
      if (distributedTopology) {
        for (const graphPath of ownerGraphPaths) {
          const graphDocument = catalog.get(graphPath);
          if (!graphDocument) {
            const findingArgs: AddFindingArgs = {
              findings,
              code: CortexStructureFindingCode.MissingIndex,
              file: graphPath,
              line: 1,
              message: `Required owner knowledge graph is missing: ${graphPath}`,
            };
            this.addFinding(findingArgs);
            continue;
          }
          graphDocuments.set(graphPath, graphDocument);
        }
      }

      const indexedByGraph = new Map<string, ReadonlySet<string>>();
      for (const [graphPath, graphDocument] of graphDocuments) {
        const indexedFiles = new Set<string>();
        const validateIndexArgs: ValidateIndexArgs = {
          indexDocument: graphDocument,
          catalog,
          excludedDocumentPaths: args.excludedDocumentPaths,
          findings,
          indexedFiles,
          repoRoot: args.repoRoot,
        };
        this.validateIndex(validateIndexArgs);
        indexedByGraph.set(graphPath, indexedFiles);
      }

      for (const [normPath] of catalog) {
        if (this.isKnowledgeGraphPath(normPath)) continue;
        const canonicalOwnerGraphPath = this.owningKnowledgeGraphPath(normPath);
        const ownerGraphPath =
          canonicalOwnerGraphPath === '.cortex/knowledge-graph.md'
            ? rootGraphPath
            : canonicalOwnerGraphPath;
        const indexedFiles = indexedByGraph.get(ownerGraphPath);
        if (indexedFiles?.has(normPath)) continue;
        const findingArgs: AddFindingArgs = {
          findings,
          code: CortexStructureFindingCode.MissingFromIndex,
          file: ownerGraphPath,
          line: 1,
          message: `Document is not indexed in its owning knowledge graph ${ownerGraphPath}: ${normPath}`,
        };
        this.addFinding(findingArgs);
      }

      if (distributedTopology) {
        const [rootIndexedFiles = new Set<string>()] = [
          indexedByGraph.get(rootGraphPath),
        ];
        for (const ownerGraphPath of ownerGraphPaths) {
          if (!rootIndexedFiles.has(ownerGraphPath)) {
            const findingArgs: AddFindingArgs = {
              findings,
              code: CortexStructureFindingCode.MissingFromIndex,
              file: rootGraphPath,
              line: 1,
              message: `Root knowledge graph must link the owner graph: ${ownerGraphPath}`,
            };
            this.addFinding(findingArgs);
          }
        }
        for (const ownerGraphPath of ownerGraphPaths) {
          const graphOwner = this.cortexGraphOwner(ownerGraphPath);
          const [ownerIndexedFiles = new Set<string>()] = [
            indexedByGraph.get(ownerGraphPath),
          ];
          for (const indexedPath of ownerIndexedFiles) {
            const indexedOwner = this.cortexGraphOwner(indexedPath);
            if (indexedOwner === false || indexedOwner === graphOwner) continue;
            const findingArgs: AddFindingArgs = {
              findings,
              code: CortexStructureFindingCode.InvalidIndexEntry,
              file: ownerGraphPath,
              line: 1,
              message: `Owning knowledge graph cannot index another context's document: ${indexedPath}`,
            };
            this.addFinding(findingArgs);
          }
        }
        for (const indexedPath of rootIndexedFiles) {
          if (
            ownerGraphPaths.some(
              (ownerGraphPath) =>
                indexedPath.startsWith(
                  `${path.posix.dirname(ownerGraphPath)}/`,
                ) && indexedPath !== ownerGraphPath,
            )
          ) {
            const findingArgs: AddFindingArgs = {
              findings,
              code: CortexStructureFindingCode.InvalidIndexEntry,
              file: rootGraphPath,
              line: 1,
              message: `Root knowledge graph must route through owner graphs instead of indexing owned documents directly: ${indexedPath}`,
            };
            this.addFinding(findingArgs);
          }
        }
      }
    }

    for (const document of parsedDocuments) {
      const normPath = this.normalizeCortexRelativePath(document.relativePath);
      if (this.isKnowledgeGraphPath(normPath)) continue;
      const validateArgs: ValidateDocumentArgs = {
        document,
        findings,
      };
      this.validateDocument(validateArgs);
    }

    return findings;
  }

  private normalizeCortexRelativePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('.cortex/')) {
      return normalized;
    }
    if (normalized.startsWith('./.cortex/')) {
      return normalized.slice(2);
    }
    return `.cortex/${normalized}`;
  }

  private parseDocument(document: CortexDocumentSource): ParsedDocument {
    const root = fromMarkdown(document.content);
    const fragments = new CortexMarkdownHeadings(root).fragments();
    return { ...document, root, fragments };
  }

  private validateDocument(args: ValidateDocumentArgs): void {
    const headings = args.document.root.children.filter((value) =>
      this.isHeading(value),
    );
    const h1s = headings.filter((heading) => heading.depth === 1);
    const [firstH1 = false] = h1s;
    const firstNode = args.document.root.children[0];

    if (h1s.length !== 1 || firstNode !== h1s[0]) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidTitle,
        file: args.document.relativePath,
        line: new CortexMarkdownNode(firstH1).line(),
        message: 'Document must begin with exactly one H1 title.',
      };
      this.addFinding(findingArgs);
    }
  }

  private validateIndex(args: ValidateIndexArgs): void {
    const headings = args.indexDocument.root.children.filter((value) =>
      this.isHeading(value),
    );
    const h1s = headings.filter((heading) => heading.depth === 1);
    const [firstH1 = false] = h1s;
    const firstNode = args.indexDocument.root.children[0];

    if (h1s.length !== 1 || firstNode !== h1s[0]) {
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidTitle,
        file: args.indexDocument.relativePath,
        line: new CortexMarkdownNode(firstH1).line(),
        message: 'Knowledge graph must begin with exactly one H1 title.',
      };
      this.addFinding(findingArgs);
    }

    const allLinks = this.collectAllLinks(args.indexDocument.root);
    const indexedLinkCounts = new Map<string, number>();
    for (const link of allLinks) {
      const resolveArgs: ResolveIndexLinkArgs = {
        url: link.url,
        indexRelativePath: args.indexDocument.relativePath,
      };
      const resolved = this.resolveIndexLink(resolveArgs);
      if (resolved === false) {
        continue;
      }

      if (args.excludedDocumentPaths.has(resolved.targetRelativePath)) {
        args.indexedFiles.add(resolved.targetRelativePath);
        continue;
      }

      const targetDoc = args.catalog.get(resolved.targetRelativePath);
      if (!targetDoc) {
        const findingArgs: AddFindingArgs = {
          findings: args.findings,
          code: CortexStructureFindingCode.InvalidIndexEntry,
          file: args.indexDocument.relativePath,
          line: new CortexMarkdownNode(link).line(),
          message: `Index link points to non-existent document: ${resolved.targetRelativePath}`,
        };
        this.addFinding(findingArgs);
        continue;
      }

      args.indexedFiles.add(resolved.targetRelativePath);
      const [linkCount = 0] = [
        indexedLinkCounts.get(resolved.targetRelativePath),
      ];
      indexedLinkCounts.set(resolved.targetRelativePath, linkCount + 1);

      if (resolved.fragment !== false) {
        if (!targetDoc.fragments.has(resolved.fragment)) {
          const findingArgs: AddFindingArgs = {
            findings: args.findings,
            code: CortexStructureFindingCode.BrokenFragment,
            file: args.indexDocument.relativePath,
            line: new CortexMarkdownNode(link).line(),
            message: `Index link points to missing heading fragment #${resolved.fragment} in ${resolved.targetRelativePath}`,
          };
          this.addFinding(findingArgs);
        }
        const findingArgs: AddFindingArgs = {
          findings: args.findings,
          code: CortexStructureFindingCode.InvalidIndexEntry,
          file: args.indexDocument.relativePath,
          line: new CortexMarkdownNode(link).line(),
          message: `Knowledge graphs route at document level and must not duplicate section links: ${resolved.targetRelativePath}#${resolved.fragment}`,
        };
        this.addFinding(findingArgs);
      }
    }

    for (const [targetPath, linkCount] of indexedLinkCounts) {
      if (linkCount <= 1) continue;
      const findingArgs: AddFindingArgs = {
        findings: args.findings,
        code: CortexStructureFindingCode.InvalidIndexEntry,
        file: args.indexDocument.relativePath,
        line: 1,
        message: `Knowledge graph must index each document once: ${targetPath}`,
      };
      this.addFinding(findingArgs);
    }
  }

  private resolveIndexLink(
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
    const normalizedIndexPath = this.normalizeCortexRelativePath(
      args.indexRelativePath,
    );
    const targetRelativePath = this.normalizeCortexRelativePath(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(normalizedIndexPath), cleanPath),
      ),
    );

    return {
      targetRelativePath,
      fragment: fragment && fragment.length > 0 ? fragment : false,
    };
  }

  private isKnowledgeGraphPath(filePath: string): boolean {
    return (
      filePath === '.cortex/knowledge-graph.md' ||
      filePath === 'knowledge-graph.md' ||
      filePath === '.cortex/k-graph.md' ||
      filePath === 'k-graph.md' ||
      filePath === '.cortex/INDEX.md' ||
      filePath === 'INDEX.md' ||
      /^\.cortex\/(?:gizmo|teams\/(?:ai|dev-core|dev-manager|security|sre|web-dev)|shared)\/knowledge-graph\.md$/.test(
        filePath,
      )
    );
  }

  private owningKnowledgeGraphPath(filePath: string): string {
    if (filePath.startsWith('.cortex/gizmo/')) {
      return '.cortex/gizmo/knowledge-graph.md';
    }
    for (const team of [
      CortexGraphOwner.Ai,
      CortexGraphOwner.DevCore,
      CortexGraphOwner.DevManager,
      CortexGraphOwner.Security,
      CortexGraphOwner.Sre,
      CortexGraphOwner.WebDev,
    ] as const) {
      if (filePath.startsWith(`.cortex/teams/${team}/`)) {
        return `.cortex/teams/${team}/knowledge-graph.md`;
      }
    }
    if (filePath.startsWith('.cortex/shared/')) {
      return '.cortex/shared/knowledge-graph.md';
    }
    return '.cortex/knowledge-graph.md';
  }

  private cortexGraphOwner(filePath: string): CortexGraphOwner | false {
    if (filePath.startsWith('.cortex/gizmo/')) return CortexGraphOwner.Gizmo;
    if (filePath.startsWith('.cortex/shared/')) return CortexGraphOwner.Shared;
    const match =
      /^\.cortex\/teams\/(ai|dev-core|dev-manager|security|sre|web-dev)\//.exec(
        filePath,
      );
    const owner = match?.[1];
    if (
      owner === CortexGraphOwner.Ai ||
      owner === CortexGraphOwner.DevCore ||
      owner === CortexGraphOwner.DevManager ||
      owner === CortexGraphOwner.Security ||
      owner === CortexGraphOwner.Sre ||
      owner === CortexGraphOwner.WebDev
    ) {
      return owner;
    }
    return false;
  }

  private collectAllLinks(root: Root): Link[] {
    const links: Link[] = [];

    this.visitMarkdownLinks({ links, node: root });
    return links;
  }

  private isHeading(node: RootContent): node is Heading {
    return node.type === 'heading';
  }

  private isLink(node: Parent | RootContent): node is Link {
    return node.type === 'link';
  }

  private addFinding(args: AddFindingArgs): void {
    const finding: CortexStructureFinding = {
      code: args.code,
      file: args.file,
      line: args.line,
      message: args.message,
    };
    args.findings.push(finding);
  }

  private visitMarkdownLinks(request: MarkdownLinkVisit): void {
    const { links, node } = request;
    if (this.isLink(node)) {
      links.push(node);
    }
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        this.visitMarkdownLinks({
          links,
          node: child as RootContent,
        });
      }
    }
  }
}

export enum CortexStructureFindingCode {
  InvalidTitle = 'invalid-title',
  ProhibitedHtml = 'prohibited-html',
  MissingIndex = 'missing-index',
  InvalidIndexEntry = 'invalid-index-entry',
  BrokenFragment = 'broken-fragment',
  MissingFromIndex = 'missing-from-index',
  MissingRelationships = 'missing-relationships',
  MissingDocumentMap = 'missing-document-map',
  InvalidRelationship = 'invalid-relationship',
  InvalidMapEntry = 'invalid-map-entry',
}

enum CortexGraphOwner {
  Ai = 'ai',
  DevCore = 'dev-core',
  DevManager = 'dev-manager',
  Gizmo = 'gizmo',
  Security = 'security',
  Sre = 'sre',
  WebDev = 'web-dev',
  Shared = 'shared',
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
  readonly excludedDocumentPaths: ReadonlySet<string>;
  readonly repoRoot: string;
};

type ParsedDocument = CortexDocumentSource & {
  readonly root: Root;
  readonly fragments: ReadonlySet<string>;
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

type ValidateMarkdownSyntaxArgs = {
  readonly document: ParsedDocument;
  readonly findings: CortexStructureFinding[];
};

export type AuditCortexMarkdownSyntaxArgs = {
  readonly documents: readonly CortexDocumentSource[];
};

export type NormalizedCortexMarkdownArgs = {
  readonly relativePath: string;
  readonly content: string;
};

type ValidateIndexArgs = {
  readonly indexDocument: ParsedDocument;
  readonly catalog: ReadonlyMap<string, ParsedDocument>;
  readonly excludedDocumentPaths: ReadonlySet<string>;
  readonly findings: CortexStructureFinding[];
  readonly indexedFiles: Set<string>;
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

type MarkdownSyntaxVisit = {
  readonly args: ValidateMarkdownSyntaxArgs;
  readonly node: RootContent | Parent;
};
type MarkdownLinkVisit = {
  readonly links: Link[];
  readonly node: RootContent | Parent;
};

export class CortexMarkdownSource {
  constructor(private readonly args: NormalizedCortexMarkdownArgs) {}
  normalized(): string {
    const args = this.args;
    return args.relativePath.endsWith('/SKILL.md') ||
      args.relativePath === 'SKILL.md'
      ? args.content.replace(
          /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,
          (frontmatter) => frontmatter.replace(/[^\r\n]/gu, ' '),
        )
      : args.content;
  }
}

export class CortexMarkdownHeadings {
  constructor(private readonly root: Root) {}
  fragments(): ReadonlySet<string> {
    const root = this.root;
    const slugger = new GithubSlugger();
    const fragments = new Set<string>();
    for (const node of root.children) {
      if (node.type === 'heading') {
        const headingText = new CortexMarkdownNode(node).text();
        const slug = slugger.slug(headingText);
        fragments.add(slug);
      }
    }
    return fragments;
  }
}

export class CortexMarkdownHeadingText {
  constructor(private readonly markdown: string) {}
  fragments(): ReadonlySet<string> {
    return new CortexMarkdownHeadings(fromMarkdown(this.markdown)).fragments();
  }
}

export class CortexMarkdownNode {
  constructor(private readonly node: RootContent | Parent | false) {}
  text(): string {
    const node = this.node;
    if (!node) {
      return '';
    }
    if ('value' in node && typeof node.value === 'string') {
      return node.value;
    }
    if ('children' in node && Array.isArray(node.children)) {
      return node.children
        .map((child) => new CortexMarkdownNode(child as RootContent).text())
        .join('');
    }
    return '';
  }
  line(): number {
    const node = this.node;
    if (!node || !node.position) {
      return 1;
    }
    return node.position.start.line;
  }
}

export class CortexMarkdownSyntaxAudit {
  constructor(private readonly args: AuditCortexMarkdownSyntaxArgs) {}
  execute(): CortexStructureFinding[] {
    return this.args.documents.flatMap((document) =>
      new CortexMarkdownSyntax({
        relativePath: document.relativePath,
        root: fromMarkdown(document.content),
      }).findings(),
    );
  }
}

class CortexMarkdownSyntax {
  constructor(
    private readonly document: {
      readonly relativePath: string;
      readonly root: Root;
    },
  ) {}
  findings(): CortexStructureFinding[] {
    return this.visit(this.document.root);
  }
  private visit(node: Root | RootContent): CortexStructureFinding[] {
    const own: CortexStructureFinding[] =
      node.type === 'html'
        ? [
            {
              code: CortexStructureFindingCode.ProhibitedHtml,
              file: this.document.relativePath,
              line: new CortexMarkdownNode(node).line(),
              message:
                'Authored HTML is prohibited in Cortex Markdown. Use Markdown syntax, escaped text, or inline or block code.',
            },
          ]
        : [];
    return 'children' in node
      ? [
          ...own,
          ...node.children.flatMap((child) => this.visit(child as RootContent)),
        ]
      : own;
  }
}
