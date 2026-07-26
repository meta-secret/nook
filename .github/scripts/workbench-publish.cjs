#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')

const repository = process.env.NOOK_WORKBENCH_REPOSITORY || 'meta-secret/nook-workbench'
const [localPath, remotePath, ...messageParts] = process.argv.slice(2)
const message = messageParts.join(' ').trim()

if (!localPath || !remotePath || !message) {
  console.error(
    'Usage: workbench-publish.cjs <local-file> <issues|worklogs|stats/...> <commit-message>',
  )
  process.exit(2)
}
if (!/^(issues|worklogs|stats)\/[a-zA-Z0-9._/-]+$/.test(remotePath) || remotePath.includes('..')) {
  console.error(`Refusing invalid Workbench path: ${remotePath}`)
  process.exit(2)
}

const content = readFileSync(localPath).toString('base64')
let sha
try {
  sha = execFileSync(
    'gh',
    ['api', `repos/${repository}/contents/${remotePath}`, '--jq', '.sha'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
} catch {
  sha = undefined
}

const args = [
  'api',
  '--method',
  'PUT',
  `repos/${repository}/contents/${remotePath}`,
  '-f',
  `message=${message}`,
  '-f',
  `content=${content}`,
  '-f',
  'branch=main',
]
if (sha) args.push('-f', `sha=${sha}`)

execFileSync('gh', args, { stdio: 'inherit' })
