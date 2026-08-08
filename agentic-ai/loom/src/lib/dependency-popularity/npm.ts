import {
  ExternalPropertyPresence,
  asExternalValue,
  externalProperty,
  type ExternalValue,
  isRecord,
} from '../guards.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type GitHubStars,
  type NpmPackageMetrics,
} from './types.ts';

import type { ExternalPropertyArgs } from '../guards.ts';
export async function fetchNpmPackageMetrics(
  name: string,
): Promise<NpmPackageMetrics> {
  const encoded = encodeURIComponent(name);
  const [downloadsResponse, metadataResponse] = await Promise.all([
    fetch(`https://api.npmjs.org/downloads/point/last-week/${encoded}`),
    fetch(`https://registry.npmjs.org/${encoded}`),
  ]);
  if (!downloadsResponse.ok) {
    throw new Error(
      `npm downloads lookup failed for ${name}: HTTP ${downloadsResponse.status}`,
    );
  }
  if (!metadataResponse.ok) {
    throw new Error(
      `npm registry lookup failed for ${name}: HTTP ${metadataResponse.status}`,
    );
  }
  const downloadsJson = asExternalValue(
    (await downloadsResponse.json()) as ExternalValue,
  );
  const metadataJson = asExternalValue(
    (await metadataResponse.json()) as ExternalValue,
  );
  const weeklyDownloadsArgs = { value: downloadsJson, name };
  const weeklyDownloads = readWeeklyDownloads(weeklyDownloadsArgs);
  const githubStars = await resolveGitHubStars(metadataJson);
  return {
    ecosystem: DependencyEcosystem.Npm,
    name,
    weeklyDownloads,
    githubStars,
  };
}

type ReadWeeklyDownloadsArgs = {
  readonly value: ExternalValue;
  readonly name: string;
};

function readWeeklyDownloads(args: ReadWeeklyDownloadsArgs): number {
  const { value, name } = args;

  if (!isRecord(value)) {
    throw new Error(`npm downloads payload invalid for ${name}`);
  }
  const downloadsArgs: ExternalPropertyArgs = {
    record: value,
    key: 'downloads',
  };
  const downloads = externalProperty(downloadsArgs);
  if (
    downloads.presence === ExternalPropertyPresence.Absent ||
    typeof downloads.value !== 'number'
  ) {
    throw new Error(`npm downloads payload invalid for ${name}`);
  }
  return downloads.value;
}

async function resolveGitHubStars(
  metadata: ExternalValue,
): Promise<GitHubStars> {
  if (!isRecord(metadata)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const repositoryPropertyArgs: ExternalPropertyArgs = {
    record: metadata,
    key: 'repository',
  };
  const repositoryProperty = externalProperty(repositoryPropertyArgs);
  let repoUrl = '';
  if (repositoryProperty.presence === ExternalPropertyPresence.Present) {
    if (typeof repositoryProperty.value === 'string') {
      repoUrl = repositoryProperty.value;
    } else if (isRecord(repositoryProperty.value)) {
      const urlPropertyArgs: ExternalPropertyArgs = {
        record: repositoryProperty.value,
        key: 'url',
      };
      const urlProperty = externalProperty(urlPropertyArgs);
      if (
        urlProperty.presence === ExternalPropertyPresence.Present &&
        typeof urlProperty.value === 'string'
      ) {
        repoUrl = urlProperty.value;
      }
    }
  }
  const slug = githubSlug(repoUrl);
  if (slug.length === 0) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const response = await fetch(`https://api.github.com/repos/${slug}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nook-loom-dependency-popularity',
    },
  });
  if (!response.ok) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const json = asExternalValue((await response.json()) as ExternalValue);
  if (!isRecord(json)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const starsArgs: ExternalPropertyArgs = {
    record: json,
    key: 'stargazers_count',
  };
  const stars = externalProperty(starsArgs);
  if (
    stars.presence === ExternalPropertyPresence.Absent ||
    typeof stars.value !== 'number'
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  return {
    presence: GitHubStarsPresence.Reported,
    stars: stars.value,
  };
}

function githubSlug(repoUrl: string): string {
  const normalized = repoUrl
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
  const match = normalized.match(
    /(?:github\.com[:/]|github\.com\/)([^/]+)\/([^/#?]+)/i,
  );
  if (!match) {
    return '';
  }
  return `${match[1]}/${match[2]}`;
}
