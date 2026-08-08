import { isRecord } from '../guards.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type GitHubStars,
  type NpmPackageMetrics,
} from './types.ts';

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
  const downloadsJson: unknown = await downloadsResponse.json();
  const metadataJson: unknown = await metadataResponse.json();
  const weeklyDownloads = readWeeklyDownloads(downloadsJson, name);
  const githubStars = await resolveGitHubStars(metadataJson);
  return {
    ecosystem: DependencyEcosystem.Npm,
    name,
    weeklyDownloads,
    githubStars,
  };
}

function readWeeklyDownloads(value: unknown, name: string): number {
  if (!isRecord(value) || typeof value.downloads !== 'number') {
    throw new Error(`npm downloads payload invalid for ${name}`);
  }
  return value.downloads;
}

async function resolveGitHubStars(metadata: unknown): Promise<GitHubStars> {
  if (!isRecord(metadata)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const repository = metadata.repository;
  const repoUrl =
    typeof repository === 'string'
      ? repository
      : isRecord(repository) && typeof repository.url === 'string'
        ? repository.url
        : '';
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
  const json: unknown = await response.json();
  if (!isRecord(json) || typeof json.stargazers_count !== 'number') {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  return {
    presence: GitHubStarsPresence.Reported,
    stars: json.stargazers_count,
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
