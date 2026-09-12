export enum GitHubStarsStateKind {
  NotLoaded = 'not-loaded',
  Loaded = 'loaded',
}

export type GitHubStarsState =
  | { kind: GitHubStarsStateKind.NotLoaded }
  | { kind: GitHubStarsStateKind.Loaded; count: number }

export enum GitHubStarsCacheLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type GitHubStarsCacheLookup =
  | { kind: GitHubStarsCacheLookupKind.Missing }
  | {
      kind: GitHubStarsCacheLookupKind.Found
      count: number
    }

export function githubStarsNotLoaded(): GitHubStarsState {
  return { kind: GitHubStarsStateKind.NotLoaded }
}

export function loadedGitHubStars(count: number): GitHubStarsState {
  return { kind: GitHubStarsStateKind.Loaded, count }
}

export function readCachedGitHubStarCount(
  storage: Storage,
): GitHubStarsCacheLookup {
  try {
    const serialized = storage.getItem('nook_github_stars')
    if (typeof serialized !== 'string') {
      return { kind: GitHubStarsCacheLookupKind.Missing }
    }
    const cached: unknown = JSON.parse(serialized)
    if (!cached || typeof cached !== 'object') {
      return { kind: GitHubStarsCacheLookupKind.Missing }
    }
    if (
      'count' in cached &&
      typeof cached.count === 'number' &&
      Number.isSafeInteger(cached.count) &&
      cached.count >= 0 &&
      'updatedAt' in cached &&
      typeof cached.updatedAt === 'number' &&
      Number.isSafeInteger(cached.updatedAt)
    ) {
      return {
        kind: GitHubStarsCacheLookupKind.Found,
        count: cached.count,
      }
    }
  } catch {
    // A malformed or unavailable cache must not affect the header.
  }
  return { kind: GitHubStarsCacheLookupKind.Missing }
}
