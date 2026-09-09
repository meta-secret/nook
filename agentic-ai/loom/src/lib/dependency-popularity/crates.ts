import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../guards.ts';

import {
  DependencyEcosystem,
  GitHubStarsPresence,
  type CrateMetrics,
  type GitHubStars,
} from './types.ts';

import type { UntrustedYamlPropertyArgs } from '../guards.ts';

export class CrateRegistryMetrics {
  private constructor(private readonly request: string) {}
  static fetch(name: string): Promise<CrateMetrics> {
    return new CrateRegistryMetrics(name).execute();
  }
  private async execute(): Promise<CrateMetrics> {
    const name = this.request;
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
    const json = UntrustedYamlBoundary.fromHost(
      (await response.json()) as UntrustedYamlNode,
    );
    if (!UntrustedYamlBoundary.isRecord(json)) {
      throw new Error(`crates.io payload invalid for ${name}`);
    }
    const cratePropertyArgs2: UntrustedYamlPropertyArgs = {
      record: json,
      key: 'crate',
    };
    const crateProperty = UntrustedYamlBoundary.property(cratePropertyArgs2);
    if (
      crateProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(crateProperty.value)
    ) {
      throw new Error(`crates.io payload invalid for ${name}`);
    }
    const crate = crateProperty.value;
    const downloadsArgs: UntrustedYamlPropertyArgs = {
      record: crate,
      key: 'downloads',
    };
    const downloads = UntrustedYamlBoundary.property(downloadsArgs);
    const recentDownloadsArgs: UntrustedYamlPropertyArgs = {
      record: crate,
      key: 'recent_downloads',
    };
    const recentDownloads = UntrustedYamlBoundary.property(recentDownloadsArgs);
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
      githubStars: await this.resolveCrateGitHubStars(json),
    };
  }

  private async resolveCrateGitHubStars(
    payload: UntrustedYamlNode,
  ): Promise<GitHubStars> {
    if (!UntrustedYamlBoundary.isRecord(payload)) {
      return { presence: GitHubStarsPresence.Unavailable };
    }
    const versionsArgs: UntrustedYamlPropertyArgs = {
      record: payload,
      key: 'versions',
    };
    const versions = UntrustedYamlBoundary.property(versionsArgs);
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
    const crateProperty = UntrustedYamlBoundary.property(cratePropertyArgs);
    if (
      crateProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(crateProperty.value)
    ) {
      return { presence: GitHubStarsPresence.Unavailable };
    }
    const repositoryArgs: UntrustedYamlPropertyArgs = {
      record: crateProperty.value,
      key: 'repository',
    };
    const repository = UntrustedYamlBoundary.property(repositoryArgs);
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
}
