import path from 'node:path';

// Legacy migration helpers remain deterministic and side-effect free.
import GithubSlugger from 'github-slugger';

import { fromMarkdown } from 'mdast-util-from-markdown';

import type { Heading, Link, List, Parent, RootContent } from 'mdast';

import type { CortexDocumentSource } from './cortex-document-structure.ts';

export class CortexNavigationIndex {
  private constructor(private readonly request: ParseDocumentIndexArgs) {}

  private static nodeText(node: RootContent | Parent | false): string {
    if (!node) {
      return '';
    }
    if ('value' in node && typeof node.value === 'string') {
      return node.value;
    }
    if ('children' in node && Array.isArray(node.children)) {
      return node.children
        .map((child) => CortexNavigationIndex.nodeText(child as RootContent))
        .join('');
    }
    return '';
  }

  private static findFirstLink(parent: Parent): Link | false {
    for (const child of parent.children) {
      if (child.type === 'link') {
        return child;
      }
      if ('children' in child && Array.isArray(child.children)) {
        const nested = CortexNavigationIndex.findFirstLink(child as Parent);
        if (nested !== false) {
          return nested;
        }
      }
    }
    return false;
  }

  private static collectNavigationItems(args: CollectEntriesArgs): void {
    for (const item of args.list.children) {
      const paragraph = item.children.find(
        (child) => child.type === 'paragraph',
      );
      if (!paragraph || paragraph.type !== 'paragraph') {
        continue;
      }
      const link = CortexNavigationIndex.findFirstLink(paragraph);
      if (link === false) {
        continue;
      }
      const text = CortexNavigationIndex.nodeText(link).trim();
      const url = link.url.trim();
      const explanations: string[] = [];
      const nestedLists = item.children.filter(
        (child): child is List => child.type === 'list',
      );
      for (const childList of nestedLists) {
        for (const nestedItem of childList.children) {
          if (CortexNavigationIndex.findFirstLink(nestedItem) === false) {
            const explanation =
              CortexNavigationIndex.nodeText(nestedItem).trim();
            if (explanation.length > 0) {
              explanations.push(explanation);
            }
          }
        }
      }
      const itemArgs: CortexNavigationItem = {
        depth: args.depth,
        text,
        url,
        explanations,
      };
      args.entries.push(itemArgs);
      for (const childList of nestedLists) {
        const nestedArgs: CollectEntriesArgs = {
          depth: args.depth + 1,
          entries: args.entries,
          list: childList,
        };
        CortexNavigationIndex.collectNavigationItems(nestedArgs);
      }
    }
  }

  private static parseNavigationSection(
    args: ParseNavigationSectionArgs,
  ): CortexNavigationItem[] {
    const entries: CortexNavigationItem[] = [];
    for (const node of args.nodes) {
      if (node.type === 'list') {
        const collectArgs: CollectEntriesArgs = {
          depth: 0,
          entries,
          list: node,
        };
        CortexNavigationIndex.collectNavigationItems(collectArgs);
      }
    }
    return entries;
  }

  static from(args: ParseDocumentIndexArgs): CortexNavigationIndex {
    return new CortexNavigationIndex(args);
  }

  public execute(): CortexDocumentIndex {
    const args = this.request;
    const root = fromMarkdown(args.source.content);
    const headings = root.children.filter(
      (node): node is Heading => node.type === 'heading',
    );
    const h1 = headings.find((heading) => heading.depth === 1);
    const title = h1
      ? CortexNavigationIndex.nodeText(h1).trim()
      : path.basename(args.source.relativePath, '.md');

    const rootH2s = headings.filter((heading) => heading.depth === 2);
    const relationshipsHeading = rootH2s.find(
      (heading) =>
        CortexNavigationIndex.nodeText(heading).trim() === 'Relationships',
    );
    const mapHeading = rootH2s.find(
      (heading) =>
        CortexNavigationIndex.nodeText(heading).trim() === 'Document map',
    );

    const relIndex = relationshipsHeading
      ? root.children.indexOf(relationshipsHeading)
      : -1;
    const mapIndex = mapHeading ? root.children.indexOf(mapHeading) : -1;

    let intro: string | false = false;
    if (h1 && relIndex > 1) {
      const introNodes = root.children.slice(1, relIndex);
      const introText = introNodes
        .map(CortexNavigationIndex.nodeText)
        .join(' ')
        .trim();
      if (introText.length > 0) {
        intro = introText;
      }
    }

    let contentStartIndex = root.children.length;
    if (mapIndex !== -1) {
      for (let index = mapIndex + 1; index < root.children.length; index += 1) {
        const node = root.children.at(index);
        if (node?.type === 'heading' && node.depth === 2) {
          contentStartIndex = index;
          break;
        }
      }
    }

    const mapNodes =
      mapIndex !== -1
        ? root.children.slice(mapIndex + 1, contentStartIndex)
        : [];
    const parseMapArgs: ParseNavigationSectionArgs = { nodes: mapNodes };
    let mapEntries = CortexNavigationIndex.parseNavigationSection(parseMapArgs);

    // If map entries were not present in the doc, derive them from content headings
    if (mapEntries.length === 0) {
      const slugger = new GithubSlugger();
      const headingNodes = root.children.filter(
        (node): node is Heading => node.type === 'heading',
      );
      const derived: CortexNavigationItem[] = [];
      const depthStack: number[] = [];
      for (const heading of headingNodes) {
        const headingText = CortexNavigationIndex.nodeText(heading).trim();
        const slug = slugger.slug(headingText);
        if (heading.depth === 1) {
          continue;
        }
        while (depthStack.length > 0) {
          const [parentDepth = 0] = [depthStack.at(-1)];
          if (parentDepth < heading.depth) break;
          depthStack.pop();
        }
        depthStack.push(heading.depth);
        const derivedItem: CortexNavigationItem = {
          depth: depthStack.length - 1,
          text: headingText,
          url: `#${slug}`,
          explanations: [],
        };
        derived.push(derivedItem);
      }
      mapEntries = derived;
    }

    const relNodes =
      relIndex !== -1 && mapIndex !== -1
        ? root.children.slice(relIndex + 1, mapIndex)
        : [];
    const parseRelArgs: ParseNavigationSectionArgs = { nodes: relNodes };
    const relationships =
      CortexNavigationIndex.parseNavigationSection(parseRelArgs);

    const relativeToCortex = args.source.relativePath.startsWith('.cortex/')
      ? args.source.relativePath.slice('.cortex/'.length)
      : args.source.relativePath;

    return {
      relativePath: relativeToCortex,
      title,
      intro,
      relationships,
      mapEntries,
    };
  }

  static extractCortexIndex(args: ExtractCortexIndexArgs): CortexIndex {
    const parsedMap = new Map<string, CortexDocumentIndex>();
    for (const source of args.documents) {
      const rel = source.relativePath.startsWith('.cortex/')
        ? source.relativePath.slice('.cortex/'.length)
        : source.relativePath;
      if (
        rel === 'knowledge-graph.md' ||
        rel === 'k-graph.md' ||
        rel === 'INDEX.md'
      ) {
        continue;
      }
      const parseArgs: ParseDocumentIndexArgs = {
        source,
        repoRoot: args.repoRoot,
      };
      const parsed = CortexNavigationIndex.from(parseArgs).execute();
      parsedMap.set(parsed.relativePath, parsed);
    }

    const sortedPaths = [...parsedMap.keys()].sort();
    const documents: CortexDocumentIndex[] = [];
    for (const filePath of sortedPaths) {
      const doc = parsedMap.get(filePath);
      if (doc) {
        documents.push(doc);
      }
    }

    return { documents };
  }

  static renderCortexIndexMarkdown(
    _args: RenderCortexIndexMarkdownArgs,
  ): string {
    return `# Cortex Context Router

Use this file only to select one owning context. Do not preload linked graphs.

## Entry contract

- [Agent routing contract](AGENTS.md) defines universal loading, ownership,
  authoring, and delivery boundaries.

## Owning contexts

- [Gizmo Prime](gizmo/knowledge-graph.md): planning, delegation, integration,
  review coordination, Workbench, pull requests, readiness, and merge.
- [PR Steward](teams/pr-steward/knowledge-graph.md): authorized mechanical
  pull-request operations, review and check observation, exact-head evidence,
  and merge execution.
  - [PR Steward contract](teams/pr-steward/AGENTS.md)
  - [Pull-request lifecycle](teams/pr-steward/workflows/pull-request-lifecycle.md)
  - [Authorization handshake](teams/pr-steward/workflows/authorization-handshake.md)
- [AI](teams/ai/knowledge-graph.md): Cortex, Loom, agent skills, workflows,
  routing, and AI automation.
- [Development core](teams/dev-core/knowledge-graph.md): portable Rust, vault
  behavior, security-control implementation, and typed WASM contracts.
- [Security](teams/security/knowledge-graph.md): security architecture,
  cryptographic policy, trust boundaries, and security review.
- [SRE](teams/sre/knowledge-graph.md): CI/CD, clusters, deployments, runners,
  containers, and operations.
- [Web development](teams/web-dev/knowledge-graph.md): TypeScript, Svelte,
  browsers, frontend behavior, and extension interaction.

## Shared dependency route

[Shared knowledge](shared/knowledge-graph.md) contains genuinely cross-team
architecture, catalogs, references, and engineering rules. Load it only for a
named dependency, then return to the selected owning context. Return a
foreign-team write requirement to Gizmo Prime.
`;
  }

  static stripDocumentNavigation(args: StripDocumentNavigationArgs): string {
    const root = fromMarkdown(args.content);
    const headings = root.children.filter(
      (node): node is Heading => node.type === 'heading',
    );
    const h1 = headings.find((heading) => heading.depth === 1);
    if (!h1 || !h1.position) {
      return args.content;
    }

    const rootH2s = headings.filter((heading) => heading.depth === 2);
    const relationshipsHeading = rootH2s.find(
      (heading) =>
        CortexNavigationIndex.nodeText(heading).trim() === 'Relationships',
    );
    const mapHeading = rootH2s.find(
      (heading) =>
        CortexNavigationIndex.nodeText(heading).trim() === 'Document map',
    );

    if (!relationshipsHeading || !mapHeading) {
      return args.content;
    }

    const relIndex = root.children.indexOf(relationshipsHeading);
    const mapIndex = root.children.indexOf(mapHeading);

    let introText = '';
    if (relIndex > 1) {
      const introStart = root.children[1]?.position?.start.offset;
      const introEnd = root.children.at(relIndex - 1)?.position?.end.offset;
      if (typeof introStart === 'number' && typeof introEnd === 'number') {
        introText = args.content.slice(introStart, introEnd).trim();
      }
    }

    let contentStartIndex = root.children.length;
    for (let index = mapIndex + 1; index < root.children.length; index += 1) {
      const node = root.children.at(index);
      if (node?.type === 'heading' && node.depth === 2) {
        contentStartIndex = index;
        break;
      }
    }

    const titleText = args.content.slice(
      h1.position.start.offset,
      h1.position.end.offset,
    );

    if (contentStartIndex >= root.children.length) {
      // Document had only title, intro, relationships, map, and no subsequent H2s
      if (introText.length > 0) {
        return `${titleText}\n\n${introText}\n`;
      }
      return `${titleText}\n`;
    }

    const firstContentNode = root.children.at(contentStartIndex);
    if (!firstContentNode?.position) {
      return args.content;
    }

    const contentBody = args.content
      .slice(firstContentNode.position.start.offset)
      .trimStart();

    if (introText.length > 0) {
      return `${titleText}\n\n${introText}\n\n${contentBody}\n`;
    }
    return `${titleText}\n\n${contentBody}\n`;
  }
}

export type CortexNavigationItem = {
  readonly depth: number;
  readonly text: string;
  readonly url: string;
  readonly explanations: readonly string[];
};

export type CortexDocumentIndex = {
  readonly relativePath: string;
  readonly title: string;
  readonly intro: string | false;
  readonly relationships: readonly CortexNavigationItem[];
  readonly mapEntries: readonly CortexNavigationItem[];
};

export type CortexIndex = {
  readonly documents: readonly CortexDocumentIndex[];
};

export type ExtractCortexIndexArgs = {
  readonly documents: readonly CortexDocumentSource[];
  readonly repoRoot: string;
};

export type RenderCortexIndexMarkdownArgs = {
  readonly index: CortexIndex;
};

export type StripDocumentNavigationArgs = {
  readonly content: string;
};

type CollectEntriesArgs = {
  readonly depth: number;
  readonly entries: CortexNavigationItem[];
  readonly list: List;
};

type ParseNavigationSectionArgs = {
  readonly nodes: readonly RootContent[];
};

type ParseDocumentIndexArgs = {
  readonly source: CortexDocumentSource;
  readonly repoRoot: string;
};
