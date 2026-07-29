#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')

const repository = process.env.NOOK_WORKBENCH_REPOSITORY || 'meta-secret/nook-workbench'
const expectedSha = process.env.NOOK_WORKBENCH_EXPECTED_SHA?.trim()
const [localPath, remotePath, ...messageParts] = process.argv.slice(2)
const message = messageParts.join(' ').trim()

if (!localPath || !remotePath || !message) {
  console.error(
    'Usage: workbench-publish.cjs <local-file> <issues|plans|worklogs|stats/...> <commit-message>',
  )
  process.exit(2)
}
if (
  !/^(issues|plans|worklogs|stats)\/[a-zA-Z0-9._/-]+$/.test(remotePath) ||
  remotePath.includes('..')
) {
  console.error(`Refusing invalid Workbench path: ${remotePath}`)
  process.exit(2)
}

const content = readFileSync(localPath).toString('base64')
let remoteFile = { kind: 'missing' }
try {
  remoteFile = {
    kind: 'present',
    sha: execFileSync(
      'gh',
      ['api', `repos/${repository}/contents/${remotePath}`, '--jq', '.sha'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim(),
  }
} catch {
  remoteFile = { kind: 'missing' }
}

if (
  remoteFile.kind === 'present' &&
  (remotePath.startsWith('plans/') || remotePath.startsWith('stats/'))
) {
  console.error(`Refusing to overwrite immutable Workbench record: ${remotePath}`)
  process.exit(3)
}
if (remoteFile.kind === 'present' && !expectedSha) {
  console.error(
    `Refusing to overwrite mutable Workbench record without NOOK_WORKBENCH_EXPECTED_SHA: ${remotePath}`,
  )
  process.exit(4)
}
if (remoteFile.kind === 'present' && remoteFile.sha !== expectedSha) {
  console.error(
    `Refusing stale Workbench update for ${remotePath}: expected ${expectedSha}, current ${remoteFile.sha}`,
  )
  process.exit(5)
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
if (remoteFile.kind === 'present') args.push('-f', `sha=${remoteFile.sha}`)

execFileSync('gh', args, { stdio: 'inherit' })
