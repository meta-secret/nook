import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../guards.ts';

import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type GitHubStars,
  type NpmPackageMetrics,
} from './types.ts';

import type { UntrustedYamlPropertyArgs } from '../guards.ts';

export class NpmRegistryMetrics {
  private constructor(private readonly request: string) {}
  static fetch(name: string): Promise<NpmPackageMetrics> {
    return new NpmRegistryMetrics(name).execute();
  }
  private async execute(): Promise<NpmPackageMetrics> {
    const name = this.request;
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
    const downloadsJson = UntrustedYamlBoundary.fromHost(
      (await downloadsResponse.json()) as UntrustedYamlNode,
    );
    const metadataJson = UntrustedYamlBoundary.fromHost(
      (await metadataResponse.json()) as UntrustedYamlNode,
    );
    const weeklyDownloadsArgs = { value: downloadsJson, name };
    const weeklyDownloads = this.readWeeklyDownloads(weeklyDownloadsArgs);
    const githubStars = await this.resolveGitHubStars(metadataJson);
    return {
      ecosystem: DependencyEcosystem.Npm,
      name,
      weeklyDownloads,
      githubStars,
    };
  }

  private readWeeklyDownloads(args: ReadWeeklyDownloadsArgs): number {
    const { value, name } = args;

    if (!UntrustedYamlBoundary.isRecord(value)) {
      throw new Error(`npm downloads payload invalid for ${name}`);
    }
    const downloadsArgs: UntrustedYamlPropertyArgs = {
      record: value,
      key: 'downloads',
    };
    const downloads = UntrustedYamlBoundary.property(downloadsArgs);
    if (
      downloads.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof downloads.value !== 'number'
    ) {
      throw new Error(`npm downloads payload invalid for ${name}`);
    }
    return downloads.value;
  }

  private async resolveGitHubStars(
    metadata: UntrustedYamlNode,
  ): Promise<GitHubStars> {
    if (!UntrustedYamlBoundary.isRecord(metadata)) {
      return { presence: GitHubStarsPresence.Unavailable };
    }
    const repositoryPropertyArgs: UntrustedYamlPropertyArgs = {
      record: metadata,
      key: 'repository',
    };
    const repositoryProperty = UntrustedYamlBoundary.property(
      repositoryPropertyArgs,
    );
    let repoUrl = '';
    if (repositoryProperty.presence === UntrustedYamlPropertyPresence.Present) {
      if (typeof repositoryProperty.value === 'string') {
        repoUrl = repositoryProperty.value;
      } else if (UntrustedYamlBoundary.isRecord(repositoryProperty.value)) {
        const urlPropertyArgs: UntrustedYamlPropertyArgs = {
          record: repositoryProperty.value,
          key: 'url',
        };
        const urlProperty = UntrustedYamlBoundary.property(urlPropertyArgs);
        if (
          urlProperty.presence === UntrustedYamlPropertyPresence.Present &&
          typeof urlProperty.value === 'string'
        ) {
          repoUrl = urlProperty.value;
        }
      }
    }
    const slug = this.githubSlug(repoUrl);
    if (slug.length === 0) {
      return { presence: GitHubStarsPresence.Unavailable };
    }
    const requestInit: RequestInit = {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nook-loom-dependency-popularity',
      },
    };
    const response = await fetch(
      `https://api.github.com/repos/${slug}`,
      requestInit,
    );
    if (!response.ok) {
      return { presence: GitHubStarsPresence.Unavailable };
    }
    const json = UntrustedYamlBoundary.fromHost(
      (await response.json()) as UntrustedYamlNode,
    );
    if (!UntrustedYamlBoundary.isRecord(json)) {
      return { presence: GitHubStarsPresence.Unavailable };
    }
    const starsArgs: UntrustedYamlPropertyArgs = {
      record: json,
      key: 'stargazers_count',
    };
    const stars = UntrustedYamlBoundary.property(starsArgs);
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

  private githubSlug(repoUrl: string): string {
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
}

type ReadWeeklyDownloadsArgs = {
  readonly value: UntrustedYamlNode;
  readonly name: string;
};
