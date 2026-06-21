import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupAllRegisteredE2eGithubRepos } from './github-repos'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(rootDir, '../.env.test.local') })

const pat = process.env.NOOK_GITHUB_PAT?.trim() ?? ''

await cleanupAllRegisteredE2eGithubRepos(pat)
