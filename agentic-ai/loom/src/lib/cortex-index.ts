import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Heading, Link, List, ListItem, Parent, RootContent } from 'mdast';
import type { CortexDocumentSource } from './cortex-document-structure.ts';

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

function findFirstLink(parent: Parent): Link | false {
  for (const child of parent.children) {
    if (child.type === 'link') {
      return child;
    }
    if ('children' in child && Array.isArray(child.children)) {
      const nested = findFirstLink(child as Parent);
      if (nested !== false) {
        return nested;
      }
    }
  }
  return false;
}

type CollectEntriesArgs = {
  readonly depth: number;
  readonly entries: CortexNavigationItem[];
  readonly list: List;
};

function collectNavigationItems(args: CollectEntriesArgs): void {
  for (const item of args.list.children) {
    const paragraph = item.children.find((child) => child.type === 'paragraph');
    if (!paragraph || paragraph.type !== 'paragraph') {
      continue;
    }
    const link = findFirstLink(paragraph);
    if (link === false) {
      continue;
    }
    const text = nodeText(link).trim();
    const url = link.url.trim();
    const explanations: string[] = [];
    const nestedLists = item.children.filter(
      (child): child is List => child.type === 'list',
    );
    for (const childList of nestedLists) {
      for (const nestedItem of childList.children) {
        if (findFirstLink(nestedItem) === false) {
          const explanation = nodeText(nestedItem).trim();
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
      collectNavigationItems(nestedArgs);
    }
  }
}

type ParseNavigationSectionArgs = {
  readonly nodes: readonly RootContent[];
};

function parseNavigationSection(
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
      collectNavigationItems(collectArgs);
    }
  }
  return entries;
}

type ParseDocumentIndexArgs = {
  readonly source: CortexDocumentSource;
  readonly repoRoot: string;
};

export function parseDocumentIndex(
  args: ParseDocumentIndexArgs,
): CortexDocumentIndex {
  const root = fromMarkdown(args.source.content);
  const headings = root.children.filter(
    (node): node is Heading => node.type === 'heading',
  );
  const h1 = headings.find((heading) => heading.depth === 1);
  const title = h1
    ? nodeText(h1).trim()
    : path.basename(args.source.relativePath, '.md');

  const rootH2s = headings.filter((heading) => heading.depth === 2);
  const relationshipsHeading = rootH2s.find(
    (heading) => nodeText(heading).trim() === 'Relationships',
  );
  const mapHeading = rootH2s.find(
    (heading) => nodeText(heading).trim() === 'Document map',
  );

  const relIndex = relationshipsHeading
    ? root.children.indexOf(relationshipsHeading)
    : -1;
  const mapIndex = mapHeading ? root.children.indexOf(mapHeading) : -1;

  let intro: string | false = false;
  if (h1 && relIndex > 1) {
    const introNodes = root.children.slice(1, relIndex);
    const introText = introNodes.map(nodeText).join(' ').trim();
    if (introText.length > 0) {
      intro = introText;
    }
  }

  let contentStartIndex = root.children.length;
  if (mapIndex !== -1) {
    for (let index = mapIndex + 1; index < root.children.length; index += 1) {
      const node = root.children[index];
      if (node?.type === 'heading' && node.depth === 2) {
        contentStartIndex = index;
        break;
      }
    }
  }

  const mapNodes =
    mapIndex !== -1 ? root.children.slice(mapIndex + 1, contentStartIndex) : [];
  const parseMapArgs: ParseNavigationSectionArgs = { nodes: mapNodes };
  let mapEntries = parseNavigationSection(parseMapArgs);

  // If map entries were not present in the doc, derive them from content headings
  if (mapEntries.length === 0) {
    const slugger = new GithubSlugger();
    const headingNodes = root.children.filter(
      (node): node is Heading => node.type === 'heading',
    );
    const derived: CortexNavigationItem[] = [];
    const depthStack: number[] = [];
    for (const heading of headingNodes) {
      const headingText = nodeText(heading).trim();
      const slug = slugger.slug(headingText);
      if (heading.depth === 1) {
        continue;
      }
      while (
        depthStack.length > 0 &&
        (depthStack.at(-1) ?? 0) >= heading.depth
      ) {
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
  const relationships = parseNavigationSection(parseRelArgs);

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

export function extractCortexIndex(args: ExtractCortexIndexArgs): CortexIndex {
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
    const parsed = parseDocumentIndex(parseArgs);
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

type CategoryDefinition = {
  readonly heading: string;
  readonly filter: (doc: CortexDocumentIndex) => boolean;
};

const CATEGORIES: readonly CategoryDefinition[] = [
  {
    heading: 'Golden Principles & Entry Points',
    filter: (doc) => !doc.relativePath.includes('/'),
  },
  {
    heading: 'Architecture Specifications (`architecture/`)',
    filter: (doc) => doc.relativePath.startsWith('architecture/'),
  },
  {
    heading: 'Dynamic Skills (`dynamic-skills/`)',
    filter: (doc) => doc.relativePath.startsWith('dynamic-skills/'),
  },
  {
    heading: 'Product Specifications (`product-specs/`)',
    filter: (doc) => doc.relativePath.startsWith('product-specs/'),
  },
  {
    heading: 'Design Documents (`design-docs/`)',
    filter: (doc) => doc.relativePath.startsWith('design-docs/'),
  },
  {
    heading: 'Workflows (`workflows/`)',
    filter: (doc) => doc.relativePath.startsWith('workflows/'),
  },
  {
    heading: 'References (`references/`)',
    filter: (doc) => doc.relativePath.startsWith('references/'),
  },
];

export function renderCortexIndexMarkdown(
  args: RenderCortexIndexMarkdownArgs,
): string {
  const lines: string[] = [];
  lines.push('# Cortex Knowledge Graph & Navigation Map');
  lines.push('');
  lines.push(
    'Central knowledge graph and index of all specifications, architecture documents, rules, skills, workflows, and references in Nook Cortex.',
  );
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(
    'This central knowledge graph provides complete hierarchical navigation across all Cortex documents.',
  );
  lines.push(
    'AI agents must always consult this knowledge graph first to discover relevant knowledge and retrieve exact section anchors without loading entire documents into context.',
  );
  lines.push('');

  for (const category of CATEGORIES) {
    const matchingDocs = args.index.documents.filter(category.filter);
    if (matchingDocs.length === 0) {
      continue;
    }
    lines.push(`## ${category.heading}`);
    lines.push('');
    for (const doc of matchingDocs) {
      lines.push(`- [${doc.title}](${doc.relativePath})`);
      if (doc.intro !== false) {
        lines.push(`  - ${doc.intro}`);
      }
      for (const entry of doc.mapEntries) {
        const indent = '  '.repeat(entry.depth + 1);
        const url = entry.url.startsWith('#')
          ? `${doc.relativePath}${entry.url}`
          : entry.url;
        lines.push(`${indent}- [${entry.text}](${url})`);
        for (const explanation of entry.explanations) {
          lines.push(`${indent}  - ${explanation}`);
        }
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function stripDocumentNavigation(
  args: StripDocumentNavigationArgs,
): string {
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
    (heading) => nodeText(heading).trim() === 'Relationships',
  );
  const mapHeading = rootH2s.find(
    (heading) => nodeText(heading).trim() === 'Document map',
  );

  if (!relationshipsHeading || !mapHeading) {
    return args.content;
  }

  const relIndex = root.children.indexOf(relationshipsHeading);
  const mapIndex = root.children.indexOf(mapHeading);

  let introText = '';
  if (relIndex > 1) {
    const introStart = root.children[1]?.position?.start.offset;
    const introEnd = root.children[relIndex - 1]?.position?.end.offset;
    if (typeof introStart === 'number' && typeof introEnd === 'number') {
      introText = args.content.slice(introStart, introEnd).trim();
    }
  }

  let contentStartIndex = root.children.length;
  for (let index = mapIndex + 1; index < root.children.length; index += 1) {
    const node = root.children[index];
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

  const firstContentNode = root.children[contentStartIndex];
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
