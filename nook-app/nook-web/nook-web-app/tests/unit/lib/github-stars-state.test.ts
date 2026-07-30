import { beforeEach, describe, expect, test } from 'vitest'
import {
  GitHubStarsCacheLookupKind,
  GitHubStarsStateKind,
  githubStarsNotLoaded,
  loadedGitHubStars,
  readCachedGitHubStarCount,
} from '../../../src/landing/github-stars-state'

describe('GitHub stars presentation state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('models the initial and loaded states with the presentation enum', () => {
    expect(githubStarsNotLoaded()).toEqual({
      kind: GitHubStarsStateKind.NotLoaded,
    })
    expect(loadedGitHubStars(42)).toEqual({
      kind: GitHubStarsStateKind.Loaded,
      count: 42,
    })
  })

  test('returns a missing cache state when no cache exists', () => {
    expect(readCachedGitHubStarCount(localStorage)).toEqual({
      kind: GitHubStarsCacheLookupKind.Missing,
    })
  })

  test('returns a found cache state for a valid persisted count', () => {
    localStorage.setItem(
      'nook_github_stars',
      JSON.stringify({ count: 42, updatedAt: 1_785_283_200_000 }),
    )

    expect(readCachedGitHubStarCount(localStorage)).toEqual({
      kind: GitHubStarsCacheLookupKind.Found,
      count: 42,
    })
  })

  test('returns a missing cache state for malformed persisted data', () => {
    localStorage.setItem('nook_github_stars', '{"count":"many"}')

    expect(readCachedGitHubStarCount(localStorage)).toEqual({
      kind: GitHubStarsCacheLookupKind.Missing,
    })
  })
})
