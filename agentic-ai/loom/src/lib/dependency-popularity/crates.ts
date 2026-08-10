import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  untrustedYamlProperty,
  type UntrustedYamlNode,
  isRecord,
} from '../guards.ts';
import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type CrateMetrics,
  type GitHubStars,
} from './types.ts';

import type { UntrustedYamlPropertyArgs } from '../guards.ts';
export async function fetchCrateMetrics(name: string): Promise<CrateMetrics> {
  const requestInit: RequestInit = {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'nook-loom-dependency-popularity (meta-secret/nook)',
    },
  };
  const response = await fetch(
    `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
    requestInit,
  );
  if (!response.ok) {
    throw new Error(
      `crates.io lookup failed for ${name}: HTTP ${response.status}`,
    );
  }
  const json = asUntrustedYamlNode(
    (await response.json()) as UntrustedYamlNode,
  );
  if (!isRecord(json)) {
    throw new Error(`crates.io payload invalid for ${name}`);
  }
  const cratePropertyArgs2: UntrustedYamlPropertyArgs = {
    record: json,
    key: 'crate',
  };
  const crateProperty = untrustedYamlProperty(cratePropertyArgs2);
  if (
    crateProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(crateProperty.value)
  ) {
    throw new Error(`crates.io payload invalid for ${name}`);
  }
  const crate = crateProperty.value;
  const downloadsArgs: UntrustedYamlPropertyArgs = {
    record: crate,
    key: 'downloads',
  };
  const downloads = untrustedYamlProperty(downloadsArgs);
  const recentDownloadsArgs: UntrustedYamlPropertyArgs = {
    record: crate,
    key: 'recent_downloads',
  };
  const recentDownloads = untrustedYamlProperty(recentDownloadsArgs);
  if (
    downloads.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof downloads.value !== 'number' ||
    recentDownloads.presence === UntrustedYamlPropertyPresence.Absent ||
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
  payload: UntrustedYamlNode,
): Promise<GitHubStars> {
  if (!isRecord(payload)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const versionsArgs: UntrustedYamlPropertyArgs = {
    record: payload,
    key: 'versions',
  };
  const versions = untrustedYamlProperty(versionsArgs);
  if (
    versions.presence === UntrustedYamlPropertyPresence.Absent ||
    !Array.isArray(versions.value)
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const cratePropertyArgs: UntrustedYamlPropertyArgs = {
    record: payload,
    key: 'crate',
  };
  const crateProperty = untrustedYamlProperty(cratePropertyArgs);
  if (
    crateProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(crateProperty.value)
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const repositoryArgs: UntrustedYamlPropertyArgs = {
    record: crateProperty.value,
    key: 'repository',
  };
  const repository = untrustedYamlProperty(repositoryArgs);
  if (
    repository.presence === UntrustedYamlPropertyPresence.Absent ||
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
  const requestInit: RequestInit = {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nook-loom-dependency-popularity',
    },
  };
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}`,
    requestInit,
  );
  if (!response.ok) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const json = asUntrustedYamlNode(
    (await response.json()) as UntrustedYamlNode,
  );
  if (!isRecord(json)) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const starsArgs: UntrustedYamlPropertyArgs = {
    record: json,
    key: 'stargazers_count',
  };
  const stars = untrustedYamlProperty(starsArgs);
  if (
    stars.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof stars.value !== 'number'
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  return {
    presence: GitHubStarsPresence.Reported,
    stars: stars.value,
  };
}
