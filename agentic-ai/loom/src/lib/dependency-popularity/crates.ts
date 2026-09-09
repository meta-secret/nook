import { err, ok, type Result } from 'neverthrow';
import {
  RegistryResponse,
  RegistryJson,
  RegistryFailureKind,
  type RegistryFailure,
} from './registry-response.ts';
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
  constructor(private readonly request: string) {}
  async execute(): Promise<Result<CrateMetrics, RegistryFailure>> {
    const name = this.request;
    const requestInit: RequestInit = {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'nook-loom-dependency-popularity (meta-secret/nook)',
      },
    };
    const fetched = await new RegistryResponse(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
      requestInit,
    ).fetch();
    if (fetched.isErr()) return err(fetched.error);
    const response = fetched.value;
    if (!response.ok) {
      return err({
        kind: RegistryFailureKind.Payload,
        message: `crates.io lookup failed for ${name}: HTTP ${response.status}`,
      });
    }
    const decoded = await new RegistryJson(response).decode();
    if (decoded.isErr()) return err(decoded.error);
    const json = decoded.value;
    if (!UntrustedYamlBoundary.isRecord(json)) {
      return err({
        kind: RegistryFailureKind.Payload,
        message: `crates.io payload invalid for ${name}`,
      });
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
      return err({
        kind: RegistryFailureKind.Payload,
        message: `crates.io payload invalid for ${name}`,
      });
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
      return err({
        kind: RegistryFailureKind.Payload,
        message: `crates.io download fields missing for ${name}`,
      });
    }
    const githubStars = await this.resolveCrateGitHubStars(json);
    if (githubStars.isErr()) return err(githubStars.error);
    return ok({
      ecosystem: DependencyEcosystem.CratesIo,
      name,
      downloads: downloads.value,
      recentDownloads: recentDownloads.value,
      githubStars: githubStars.value,
    });
  }

  private async resolveCrateGitHubStars(
    payload: UntrustedYamlNode,
  ): Promise<Result<GitHubStars, RegistryFailure>> {
    if (!UntrustedYamlBoundary.isRecord(payload)) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
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
      return ok({ presence: GitHubStarsPresence.Unavailable });
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
      return ok({ presence: GitHubStarsPresence.Unavailable });
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
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const match = repository.value.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    const owner = match?.[1];
    const repo = match?.[2];
    if (typeof owner !== 'string' || typeof repo !== 'string') {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const requestInit: RequestInit = {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nook-loom-dependency-popularity',
      },
    };
    const fetched = await new RegistryResponse(
      `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}`,
      requestInit,
    ).fetch();
    if (fetched.isErr()) return err(fetched.error);
    const response = fetched.value;
    if (!response.ok) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    const decoded = await new RegistryJson(response).decode();
    if (decoded.isErr()) return err(decoded.error);
    const json = decoded.value;
    if (!UntrustedYamlBoundary.isRecord(json)) {
      return ok({ presence: GitHubStarsPresence.Unavailable });
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
      return ok({ presence: GitHubStarsPresence.Unavailable });
    }
    return ok({
      presence: GitHubStarsPresence.Reported,
      stars: stars.value,
    });
  }
}
