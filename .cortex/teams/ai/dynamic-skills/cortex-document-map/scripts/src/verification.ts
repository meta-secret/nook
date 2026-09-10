import { err, ok, type Result } from 'neverthrow';
import { CortexDocumentMapResultDecodeError } from './codec.ts';
import path from 'node:path';

import GithubSlugger from 'github-slugger';

import { fromMarkdown } from 'mdast-util-from-markdown';

import type { Heading, Link, Parent, Root, RootContent } from 'mdast';

import {
  CortexStructureFindingCode,
  type CortexStructureFinding,
} from './cortex-document-structure.ts';

import {
  CortexDocumentMapContractKind,
  type AuditCortexDocumentMapRequest,
  type CortexDocumentMapResult,
} from './domain.ts';

export class CortexDocumentMapVerifier {
  private constructor(
    private readonly request: VerifyCortexDocumentMapResultRequest,
  ) {}

  static from(
    request: VerifyCortexDocumentMapResultRequest,
  ): CortexDocumentMapVerifier {
    return new CortexDocumentMapVerifier(request);
  }

  public execute(): Result<void, CortexDocumentMapResultDecodeError> {
    const request = this.request;
    if (
      request.auditRequest.kind !== CortexDocumentMapContractKind.Request ||
      request.result.kind !== CortexDocumentMapContractKind.Result
    ) {
      return err(
        new CortexDocumentMapResultDecodeError({ message: FAILURE, path: '' }),
      );
    }
    const expected = this.deriveIndependentFindings(request.auditRequest);
    if (expected.length !== request.result.findings.length) {
      return err(
        new CortexDocumentMapResultDecodeError({ message: FAILURE, path: '' }),
      );
    }
    for (const [index, wanted] of expected.entries()) {
      const [actual = false] = [request.result.findings.at(index)];
      if (
        actual === false ||
        actual.code !== wanted.code ||
        actual.file !== wanted.file ||
        actual.line !== wanted.line ||
        actual.message !== wanted.message
      ) {
        return err(
          new CortexDocumentMapResultDecodeError({
            message: FAILURE,
            path: '',
          }),
        );
      }
    }
    return ok();
  }

  private deriveIndependentFindings(
    request: AuditCortexDocumentMapRequest,
  ): CortexStructureFinding[] {
    const findings: CortexStructureFinding[] = [];
    const invalidSyntaxPaths = new Set<string>();
    for (const document of request.documents) {
      const root = fromMarkdown(document.content);
      this.walk({
        root,
        visit: (node) => {
          if (node.type !== 'html') return;
          invalidSyntaxPaths.add(document.relativePath);
          findings.push({
            code: CortexStructureFindingCode.ProhibitedHtml,
            file: document.relativePath,
            line: this.line(node),
            message:
              'Authored HTML is prohibited in Cortex Markdown. Use Markdown syntax, escaped text, or inline or block code.',
          });
        },
      });
    }
    const omitted = new Set([
      ...request.excludedDocumentPaths,
      ...invalidSyntaxPaths,
    ]);
    const documents = request.documents
      .filter((document) => !omitted.has(document.relativePath))
      .map((document) => this.evidenceDocument(document));
    this.deriveTopology({
      documents,
      invalidSyntaxPaths,
      findings,
    });
    return findings;
  }

  private deriveTopology(args: {
    readonly documents: readonly EvidenceDocument[];
    readonly invalidSyntaxPaths: ReadonlySet<string>;
    readonly findings: CortexStructureFinding[];
  }): void {
    const catalog = new Map(
      args.documents.map((document) => [
        this.normalize(document.relativePath),
        document,
      ]),
    );
    const [root = false] = [
      ['.cortex/knowledge-graph.md', '.cortex/k-graph.md', '.cortex/INDEX.md']
        .map((path) => catalog.get(path))
        .find(Boolean),
    ];
    if (root === false) {
      this.add(args.findings)({
        code: CortexStructureFindingCode.MissingIndex,
        file: '.cortex/knowledge-graph.md',
        line: 1,
        message:
          'Centralized Cortex knowledge graph `.cortex/knowledge-graph.md` is missing.',
      });
    } else {
      this.deriveGraphFindings({ ...args, catalog, root });
    }
    for (const document of args.documents) {
      if (!this.isGraph(this.normalize(document.relativePath))) {
        this.deriveDocumentFindings({
          document,
          findings: args.findings,
        });
      }
    }
  }

  private deriveGraphFindings(args: {
    readonly documents: readonly EvidenceDocument[];
    readonly invalidSyntaxPaths: ReadonlySet<string>;
    readonly findings: CortexStructureFinding[];
    readonly catalog: ReadonlyMap<string, EvidenceDocument>;
    readonly root: EvidenceDocument;
  }): void {
    const distributed = OWNER_GRAPHS.some((graphPath) =>
      args.catalog.has(graphPath),
    );
    const graphDocuments = new Map<string, EvidenceDocument>();
    const rootPath = this.normalize(args.root.relativePath);
    graphDocuments.set(rootPath, args.root);
    if (distributed) {
      for (const graphPath of OWNER_GRAPHS) {
        const [graph = false] = [args.catalog.get(graphPath)];
        if (graph === false) {
          this.add(args.findings)({
            code: CortexStructureFindingCode.MissingIndex,
            file: graphPath,
            line: 1,
            message: `Required owner knowledge graph is missing: ${graphPath}`,
          });
        } else graphDocuments.set(graphPath, graph);
      }
    }
    const indexedByGraph = new Map<string, ReadonlySet<string>>();
    for (const [graphPath, graph] of graphDocuments) {
      const indexed = new Set<string>();
      this.deriveIndexFindings({
        graph,
        catalog: args.catalog,
        syntaxInvalidPaths: args.invalidSyntaxPaths,
        indexed,
        findings: args.findings,
      });
      indexedByGraph.set(graphPath, indexed);
    }
    for (const document of args.documents) {
      const documentPath = this.normalize(document.relativePath);
      if (this.isGraph(documentPath)) continue;
      const ownerGraph = this.owningGraph(documentPath);
      const graphPath =
        ownerGraph === '.cortex/knowledge-graph.md' ? rootPath : ownerGraph;
      if (indexedByGraph.get(graphPath)?.has(documentPath)) continue;
      this.add(args.findings)({
        code: CortexStructureFindingCode.MissingFromIndex,
        file: graphPath,
        line: 1,
        message: `Document is not indexed in its owning knowledge graph ${graphPath}: ${documentPath}`,
      });
    }
    if (!distributed) return;
    const [rootIndexed = new Set<string>()] = [indexedByGraph.get(rootPath)];
    for (const graphPath of OWNER_GRAPHS) {
      if (rootIndexed.has(graphPath)) continue;
      this.add(args.findings)({
        code: CortexStructureFindingCode.MissingFromIndex,
        file: rootPath,
        line: 1,
        message: `Root knowledge graph must link the owner graph: ${graphPath}`,
      });
    }
    for (const graphPath of OWNER_GRAPHS) {
      const [indexedPaths = []] = [indexedByGraph.get(graphPath)];
      for (const indexedPath of indexedPaths) {
        const indexedOwner = this.owner(indexedPath);
        if (indexedOwner === false || indexedOwner === this.owner(graphPath))
          continue;
        this.add(args.findings)({
          code: CortexStructureFindingCode.InvalidIndexEntry,
          file: graphPath,
          line: 1,
          message: `Owning knowledge graph cannot index another context's document: ${indexedPath}`,
        });
      }
    }
    for (const indexedPath of rootIndexed) {
      const bypassesOwner = OWNER_GRAPHS.some(
        (graphPath) =>
          indexedPath.startsWith(`${path.posix.dirname(graphPath)}/`) &&
          indexedPath !== graphPath,
      );
      if (!bypassesOwner) continue;
      this.add(args.findings)({
        code: CortexStructureFindingCode.InvalidIndexEntry,
        file: rootPath,
        line: 1,
        message: `Root knowledge graph must route through owner graphs instead of indexing owned documents directly: ${indexedPath}`,
      });
    }
  }

  private deriveIndexFindings(args: {
    readonly graph: EvidenceDocument;
    readonly catalog: ReadonlyMap<string, EvidenceDocument>;
    readonly syntaxInvalidPaths: ReadonlySet<string>;
    readonly indexed: Set<string>;
    readonly findings: CortexStructureFinding[];
  }): void {
    const headings = args.graph.root.children.filter(this.isHeading);
    const h1s = headings.filter((heading) => heading.depth === 1);
    const [firstH1 = false] = h1s;
    if (h1s.length !== 1 || args.graph.root.children[0] !== h1s[0]) {
      this.add(args.findings)({
        code: CortexStructureFindingCode.InvalidTitle,
        file: args.graph.relativePath,
        line: this.line(firstH1),
        message: 'Knowledge graph must begin with exactly one H1 title.',
      });
    }
    const counts = new Map<string, number>();
    for (const link of this.links(args.graph.root)) {
      const resolved = this.resolveLink({
        indexPath: args.graph.relativePath,
        url: link.url,
      });
      if (resolved === false) continue;
      if (args.syntaxInvalidPaths.has(resolved.target)) {
        args.indexed.add(resolved.target);
        continue;
      }
      const [target = false] = [args.catalog.get(resolved.target)];
      if (target === false) {
        this.add(args.findings)({
          code: CortexStructureFindingCode.InvalidIndexEntry,
          file: args.graph.relativePath,
          line: this.line(link),
          message: `Index link points to non-existent document: ${resolved.target}`,
        });
        continue;
      }
      args.indexed.add(resolved.target);
      const [count = 0] = [counts.get(resolved.target)];
      counts.set(resolved.target, count + 1);
      if (resolved.fragment === false) continue;
      if (!target.fragments.has(resolved.fragment)) {
        this.add(args.findings)({
          code: CortexStructureFindingCode.BrokenFragment,
          file: args.graph.relativePath,
          line: this.line(link),
          message: `Index link points to missing heading fragment #${resolved.fragment} in ${resolved.target}`,
        });
      }
      this.add(args.findings)({
        code: CortexStructureFindingCode.InvalidIndexEntry,
        file: args.graph.relativePath,
        line: this.line(link),
        message: `Knowledge graphs route at document level and must not duplicate section links: ${resolved.target}#${resolved.fragment}`,
      });
    }
    for (const [target, count] of counts) {
      if (count <= 1) continue;
      this.add(args.findings)({
        code: CortexStructureFindingCode.InvalidIndexEntry,
        file: args.graph.relativePath,
        line: 1,
        message: `Knowledge graph must index each document once: ${target}`,
      });
    }
  }

  private deriveDocumentFindings(args: {
    readonly document: EvidenceDocument;
    readonly findings: CortexStructureFinding[];
  }): void {
    const headings = args.document.root.children.filter(this.isHeading);
    const h1s = headings.filter((heading) => heading.depth === 1);
    const [firstH1 = false] = h1s;
    if (h1s.length !== 1 || args.document.root.children[0] !== h1s[0]) {
      this.add(args.findings)({
        code: CortexStructureFindingCode.InvalidTitle,
        file: args.document.relativePath,
        line: this.line(firstH1),
        message: 'Document must begin with exactly one H1 title.',
      });
    }
  }

  private evidenceDocument(
    document: AuditCortexDocumentMapRequest['documents'][number],
  ): EvidenceDocument {
    const content = document.relativePath.endsWith('/SKILL.md')
      ? document.content.replace(
          /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,
          (frontmatter) => frontmatter.replace(/[^\r\n]/gu, ' '),
        )
      : document.content;
    const root = fromMarkdown(content);
    const slugger = new GithubSlugger();
    const fragments = new Set<string>();
    for (const heading of root.children.filter(this.isHeading))
      fragments.add(slugger.slug(this.nodeText(heading)));
    return { relativePath: document.relativePath, root, fragments };
  }

  private resolveLink(args: ResolveLinkInput): ResolvedLink | false {
    const url = args.url.trim();
    if (/^(?:https?:|mailto:)/u.test(url)) return false;
    const hash = url.indexOf('#');
    const pathPart = hash === -1 ? url : url.slice(0, hash);
    if (pathPart.length === 0) return false;
    const fragment =
      hash === -1 ? false : decodeURIComponent(url.slice(hash + 1)) || false;
    const target = this.normalize(
      path.posix.join(
        path.posix.dirname(this.normalize(args.indexPath)),
        pathPart.replace(/\\/gu, '/'),
      ),
    );
    return { target, fragment };
  }

  private normalize(value: string): string {
    const normalized = value.replace(/\\/gu, '/');
    if (normalized.startsWith('.cortex/')) return normalized;
    if (normalized.startsWith('./.cortex/')) return normalized.slice(2);
    return `.cortex/${normalized}`;
  }

  private isGraph(value: string): boolean {
    return (
      /^(?:\.cortex\/)?(?:knowledge-graph|k-graph|INDEX)\.md$/u.test(value) ||
      /^\.cortex\/(?:gizmo|teams\/(?:ai|dev-core|security|sre|web-dev)|shared)\/knowledge-graph\.md$/u.test(
        value,
      )
    );
  }

  private owningGraph(value: string): string {
    const match =
      /^(\.cortex\/(?:gizmo|shared|teams\/(?:ai|dev-core|security|sre|web-dev)))\//u.exec(
        value,
      );
    return match
      ? `${match[1]}/knowledge-graph.md`
      : '.cortex/knowledge-graph.md';
  }

  private owner(value: string): string | false {
    const match =
      /^\.cortex\/(gizmo|shared|teams\/(?:ai|dev-core|security|sre|web-dev))\//u.exec(
        value,
      );
    if (!match) return false;
    const [, context = false] = match;
    return context;
  }

  private links(root: Root): Link[] {
    const found: Link[] = [];
    this.walk({
      root,
      visit: (node) => {
        if (node.type === 'link') found.push(node);
      },
    });
    return found;
  }

  private walk(args: {
    readonly root: Root | RootContent;
    readonly visit: (node: RootContent) => void;
  }): void {
    if (args.root.type !== 'root') args.visit(args.root);
    if (!('children' in args.root) || !Array.isArray(args.root.children))
      return;
    for (const child of args.root.children)
      this.walk({ root: child, visit: args.visit });
  }

  private isHeading(node: RootContent): node is Heading {
    return node.type === 'heading';
  }

  private nodeText(node: RootContent | Parent | false): string {
    if (node === false) return '';
    if ('value' in node && typeof node.value === 'string') return node.value;
    return 'children' in node
      ? node.children.map((child) => this.nodeText(child)).join('')
      : '';
  }

  private line(node: RootContent | Parent | false): number {
    return node === false || !node.position ? 1 : node.position.start.line;
  }

  private add(
    findings: CortexStructureFinding[],
  ): (finding: FindingInput) => void {
    return (finding) => findings.push(finding);
  }
}

export type VerifyCortexDocumentMapResultRequest = {
  readonly auditRequest: AuditCortexDocumentMapRequest;
  readonly result: CortexDocumentMapResult;
};

type EvidenceDocument = {
  readonly relativePath: string;
  readonly root: Root;
  readonly fragments: ReadonlySet<string>;
};

type FindingInput = CortexStructureFinding;

type ResolveLinkInput = {
  readonly indexPath: string;
  readonly url: string;
};

type ResolvedLink = {
  readonly target: string;
  readonly fragment: string | false;
};

const OWNER_GRAPHS = [
  '.cortex/gizmo/knowledge-graph.md',
  '.cortex/teams/ai/knowledge-graph.md',
  '.cortex/teams/dev-core/knowledge-graph.md',
  '.cortex/teams/security/knowledge-graph.md',
  '.cortex/teams/sre/knowledge-graph.md',
  '.cortex/teams/web-dev/knowledge-graph.md',
  '.cortex/shared/knowledge-graph.md',
] as const;

const FAILURE = 'Cortex document-map verification failed.';
