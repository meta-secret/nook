import { isRecord } from '../guards.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type CrateMetrics,
  type GitHubStars,
} from './types.ts';

export async function fetchCrateMetrics(name: string): Promise<CrateMetrics> {
  const response = await fetch(
    `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'nook-loom-dependency-popularity (meta-secret/nook)',
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `crates.io lookup failed for ${name}: HTTP ${response.status}`,
    );
  }
  const json: unknown = await response.json();
  if (!isRecord(json) || !isRecord(json.crate)) {
    throw new Error(`crates.io payload invalid for ${name}`);
  }
  const crate = json.crate;
  if (
    typeof crate.downloads !== 'number' ||
    typeof crate.recent_downloads !== 'number'
  ) {
    throw new Error(`crates.io download fields missing for ${name}`);
  }
  return {
    ecosystem: DependencyEcosystem.CratesIo,
    name,
    downloads: crate.downloads,
    recentDownloads: crate.recent_downloads,
    githubStars: await resolveCrateGitHubStars(json),
  };
}

async function resolveCrateGitHubStars(payload: unknown): Promise<GitHubStars> {
  if (!isRecord(payload) || !Array.isArray(payload.versions)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  // Repository URL is on the crate object in newer API responses.
  if (
    !isRecord(payload.crate) ||
    typeof payload.crate.repository !== 'string'
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const match = payload.crate.repository.match(
    /github\.com\/([^/]+)\/([^/#?]+)/i,
  );
  const owner = match?.[1];
  const repo = match?.[2];
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nook-loom-dependency-popularity',
      },
    },
  );
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
