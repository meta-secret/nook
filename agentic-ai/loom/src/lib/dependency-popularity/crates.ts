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
  type CrateMetrics,
  type GitHubStars,
} from './types.ts';

import type { ExternalPropertyArgs } from '../guards.ts';
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
  const json = asExternalValue((await response.json()) as ExternalValue);
  if (!isRecord(json)) {
    throw new Error(`crates.io payload invalid for ${name}`);
  }
  const cratePropertyArgs2: ExternalPropertyArgs = {
    record: json,
    key: 'crate',
  };
  const crateProperty = externalProperty(cratePropertyArgs2);
  if (
    crateProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(crateProperty.value)
  ) {
    throw new Error(`crates.io payload invalid for ${name}`);
  }
  const crate = crateProperty.value;
  const downloadsArgs: ExternalPropertyArgs = {
    record: crate,
    key: 'downloads',
  };
  const downloads = externalProperty(downloadsArgs);
  const recentDownloadsArgs: ExternalPropertyArgs = {
    record: crate,
    key: 'recent_downloads',
  };
  const recentDownloads = externalProperty(recentDownloadsArgs);
  if (
    downloads.presence === ExternalPropertyPresence.Absent ||
    typeof downloads.value !== 'number' ||
    recentDownloads.presence === ExternalPropertyPresence.Absent ||
    typeof recentDownloads.value !== 'number'
  ) {
    throw new Error(`crates.io download fields missing for ${name}`);
  }
  return {
    ecosystem: DependencyEcosystem.CratesIo,
    name,
    downloads: downloads.value,
    recentDownloads: recentDownloads.value,
    githubStars: await resolveCrateGitHubStars(json),
  };
}

async function resolveCrateGitHubStars(
  payload: ExternalValue,
): Promise<GitHubStars> {
  if (!isRecord(payload)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const versionsArgs: ExternalPropertyArgs = {
    record: payload,
    key: 'versions',
  };
  const versions = externalProperty(versionsArgs);
  if (
    versions.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(versions.value)
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const cratePropertyArgs: ExternalPropertyArgs = {
    record: payload,
    key: 'crate',
  };
  const crateProperty = externalProperty(cratePropertyArgs);
  if (
    crateProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(crateProperty.value)
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const repositoryArgs: ExternalPropertyArgs = {
    record: crateProperty.value,
    key: 'repository',
  };
  const repository = externalProperty(repositoryArgs);
  if (
    repository.presence === ExternalPropertyPresence.Absent ||
    typeof repository.value !== 'string'
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const match = repository.value.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
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
