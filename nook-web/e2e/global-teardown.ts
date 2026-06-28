import { cleanupAllRegisteredE2eGithubRepos } from './github-repos'
import { githubPat } from './helpers'

export default async function globalTeardown() {
  // Local-only Playwright runs in parallel with GitHub e2e on CI (shared workspace).
  // Skip cleanup here so the local container does not delete repos the GitHub track still needs.
  if (process.env.NOOK_E2E_SKIP_GITHUB_CLEANUP === '1') {
    return
  }
  await cleanupAllRegisteredE2eGithubRepos(githubPat)
}
