import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Definition,
  Image,
  ImageReference,
  Link,
  LinkReference,
  Root,
} from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { Result } from 'neverthrow';

export type MarkdownLink = {
  readonly target: string;
  readonly line: number;
};

/** Parses real Markdown links, including references, without inspecting examples. */
export class MarkdownLinkDocument {
  private readonly root: Root;

  constructor(content: string) {
    this.root = unified().use(remarkParse).use(remarkGfm).parse(content);
  }

  links(): readonly MarkdownLink[] {
    const definitions: Definition[] = [];
    visit(this.root, 'definition', (node) => {
      definitions.push(node);
    });
    const links: MarkdownLink[] = [];
    visit(
      this.root,
      ['link', 'image', 'linkReference', 'imageReference'] as const,
      (node) => {
        switch (node.type) {
          case 'link':
          case 'image':
            links.push({ target: node.url, line: this.line(node) });
            return;
          case 'linkReference':
          case 'imageReference':
            this.appendReference({ node, definitions, links });
        }
      },
    );
    return links;
  }

  private appendReference(request: AppendReferenceRequest): void {
    for (const definition of request.definitions) {
      switch (definition.identifier.toUpperCase()) {
        case request.node.identifier.toUpperCase():
          request.links.push({
            target: definition.url,
            line: this.line(request.node),
          });
          return;
      }
    }
  }

  private line(node: Link | Image | LinkReference | ImageReference): number {
    assert(node.position, 'Parsed Markdown link must have a source position.');
    return node.position.start.line;
  }
}

type AppendReferenceRequest = {
  readonly node: LinkReference | ImageReference;
  readonly definitions: readonly Definition[];
  readonly links: MarkdownLink[];
};

export class RepositoryMarkdownLinks {
  private constructor(private readonly request: FindBrokenRelativeLinksArgs) {}

  static findBroken(args: FindBrokenRelativeLinksArgs): BrokenLink[] {
    return new RepositoryMarkdownLinks(args).execute();
  }

  static targets(
    args: FindBrokenRelativeLinksArgs,
  ): readonly FileMarkdownLink[] {
    return new RepositoryMarkdownLinks(args).fileTargets();
  }

  private execute(): BrokenLink[] {
    return this.resolutions().flatMap((resolution) =>
      resolution.match(
        (links) => links.flatMap((link) => this.fileFindings(link)),
        (finding) => [finding],
      ),
    );
  }

  private fileTargets(): FileMarkdownLink[] {
    return this.resolutions().flatMap((resolution) =>
      resolution.match(
        (links) => links,
        () => [],
      ),
    );
  }

  private resolutions(): Result<FileMarkdownLink[], BrokenLink>[] {
    return new MarkdownLinkDocument(this.request.content).links().map((link) =>
      Result.fromThrowable(
        () => this.resolve(link),
        () => this.finding(link),
      )(),
    );
  }

  private resolve(link: MarkdownLink): FileMarkdownLink[] {
    switch (link.target.charAt(0)) {
      case '':
      case '#':
        return [];
    }
    const resolved = new URL(link.target, pathToFileURL(this.request.filePath));
    switch (resolved.protocol) {
      case 'file:':
        return [{ ...link, filePath: fileURLToPath(resolved) }];
      default:
        return [];
    }
  }

  private fileFindings(link: FileMarkdownLink): BrokenLink[] {
    switch (existsSync(link.filePath)) {
      case true:
        return [];
      case false:
        return [this.finding(link)];
    }
  }

  private finding(link: MarkdownLink): BrokenLink {
    return {
      file: path.relative(this.request.repoRoot, this.request.filePath),
      line: link.line,
      target: link.target,
    };
  }
}

export type FileMarkdownLink = MarkdownLink & { readonly filePath: string };

export type BrokenLink = {
  readonly file: string;
  readonly line: number;
  readonly target: string;
};

export type FindBrokenRelativeLinksArgs = {
  readonly filePath: string;
  readonly content: string;
  readonly repoRoot: string;
};
