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
  const crateProperty = externalProperty({ record: json, key: 'crate' });
  if (
    crateProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(crateProperty.value)
  ) {
    throw new Error(`crates.io payload invalid for ${name}`);
  }
  const crate = crateProperty.value;
  const downloads = externalProperty({ record: crate, key: 'downloads' });
  const recentDownloads = externalProperty({
    record: crate,
    key: 'recent_downloads',
  });
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
  const versions = externalProperty({ record: payload, key: 'versions' });
  if (
    versions.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(versions.value)
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const crateProperty = externalProperty({ record: payload, key: 'crate' });
  if (
    crateProperty.presence === ExternalPropertyPresence.Absent ||
    !isRecord(crateProperty.value)
  ) {
    return { presence: GitHubStarsPresence.Unavailable };
  }
  const repository = externalProperty({
    record: crateProperty.value,
    key: 'repository',
  });
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
  const stars = externalProperty({ record: json, key: 'stargazers_count' });
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
