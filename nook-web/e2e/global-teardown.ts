import { cleanupAllRegisteredE2eGithubRepos } from './github-repos'
import { githubPat } from './helpers'

export default async function globalTeardown() {
  await cleanupAllRegisteredE2eGithubRepos(githubPat)
}
