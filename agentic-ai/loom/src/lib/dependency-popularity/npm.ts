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
  const weeklyDownloads = readWeeklyDownloads({ value: downloadsJson, name });
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
  const downloads = externalProperty({ record: value, key: 'downloads' });
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
  const repositoryProperty = externalProperty({
    record: metadata,
    key: 'repository',
  });
  let repoUrl = '';
  if (repositoryProperty.presence === ExternalPropertyPresence.Present) {
    if (typeof repositoryProperty.value === 'string') {
      repoUrl = repositoryProperty.value;
    } else if (isRecord(repositoryProperty.value)) {
      const urlProperty = externalProperty({
        record: repositoryProperty.value,
        key: 'url',
      });
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
