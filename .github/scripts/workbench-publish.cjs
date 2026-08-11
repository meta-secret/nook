#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { readFileSync, realpathSync } = require('node:fs')
const { isAbsolute, relative, resolve } = require('node:path')
const { validateAgentRecord } = require('./workbench-records.cjs')

const WorkbenchRemoteFileKind = Object.freeze({
  Missing: 'missing',
  Present: 'present',
})

const repository =
  process.env.NOOK_WORKBENCH_REPOSITORY || 'meta-secret/nook-workbench'
const expectedSha = process.env.NOOK_WORKBENCH_EXPECTED_SHA?.trim()
const sourceTaskFile = (
  process.env.NOOK_WORKBENCH_SOURCE_TASK_FILE || ''
).trim()
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

const localContent = readFileSync(localPath, 'utf8')
if (remotePath.startsWith('plans/')) {
  if (!sourceTaskFile) {
    console.error(
      'Refusing Workbench plan without NOOK_WORKBENCH_SOURCE_TASK_FILE',
    )
    process.exit(6)
  }
  const checkoutRoot = realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim(),
  )
  const sourceTaskPath = realpathSync(resolve(sourceTaskFile))
  const sourceTaskRelativePath = relative(checkoutRoot, sourceTaskPath)
  if (
    sourceTaskRelativePath === '' ||
    (!sourceTaskRelativePath.startsWith('..') &&
      !isAbsolute(sourceTaskRelativePath))
  ) {
    console.error(
      'Refusing source-task file inside the public Nook checkout',
    )
    process.exit(8)
  }
  const sourceTask = readFileSync(sourceTaskPath, 'utf8')
  const rejection = validateAgentRecord(localContent, 'plan', [], sourceTask)
  if (rejection) {
    console.error(`Refusing invalid Workbench plan: ${rejection}`)
    process.exit(7)
  }
}
const content = Buffer.from(localContent).toString('base64')
let remoteFile = { kind: WorkbenchRemoteFileKind.Missing }
try {
  remoteFile = {
    kind: WorkbenchRemoteFileKind.Present,
    sha: execFileSync(
      'gh',
      ['api', `repos/${repository}/contents/${remotePath}`, '--jq', '.sha'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim(),
  }
} catch {
  remoteFile = { kind: WorkbenchRemoteFileKind.Missing }
}

if (
  remoteFile.kind === WorkbenchRemoteFileKind.Present &&
  (remotePath.startsWith('plans/') || remotePath.startsWith('stats/'))
) {
  console.error(
    `Refusing to overwrite immutable Workbench record: ${remotePath}`,
  )
  process.exit(3)
}
if (remoteFile.kind === WorkbenchRemoteFileKind.Present && !expectedSha) {
  console.error(
    `Refusing to overwrite mutable Workbench record without NOOK_WORKBENCH_EXPECTED_SHA: ${remotePath}`,
  )
  process.exit(4)
}
if (
  remoteFile.kind === WorkbenchRemoteFileKind.Present &&
  remoteFile.sha !== expectedSha
) {
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
if (remoteFile.kind === WorkbenchRemoteFileKind.Present) {
  args.push('-f', `sha=${remoteFile.sha}`)
}

execFileSync('gh', args, { stdio: 'inherit' })
