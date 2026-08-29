#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { readFileSync, realpathSync } = require('node:fs')
const { isAbsolute, relative, resolve, sep } = require('node:path')
const { validateAgentRecord } = require('./workbench-records.cjs')

const WorkbenchRemoteFileKind = Object.freeze({
  Missing: 'missing',
  Present: 'present',
})

const SourceTaskFileKind = Object.freeze({
  Missing: 'missing',
  Present: 'present',
})

function parsePlanFrontmatterGizmoId(content) {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!frontmatterMatch) {
    return { kind: 'invalid', message: 'missing YAML frontmatter' }
  }
  const gizmoIdRows = [
    ...frontmatterMatch[1].matchAll(/^gizmo_id:\s*(.*?)\s*$/gm),
  ]
  if (gizmoIdRows.length !== 1) {
    return {
      kind: 'invalid',
      message: 'YAML frontmatter requires exactly one gizmo_id',
    }
  }
  const value = gizmoIdRows[0][1].trim()
  if (value === 'null' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return { kind: 'invalid', message: 'YAML frontmatter gizmo_id is invalid' }
  }
  return { kind: 'valid', value }
}

const repository =
  process.env.NOOK_WORKBENCH_REPOSITORY || 'meta-secret/nook-workbench'
const expectedSha = process.env.NOOK_WORKBENCH_EXPECTED_SHA?.trim()
const assignedGizmoId =
  process.env.NOOK_WORKBENCH_ASSIGNED_GIZMO_ID?.trim() || ''
let sourceTaskFile = { kind: SourceTaskFileKind.Missing }
if (typeof process.env.NOOK_WORKBENCH_SOURCE_TASK_FILE === 'string') {
  const path = process.env.NOOK_WORKBENCH_SOURCE_TASK_FILE.trim()
  if (path.length > 0) {
    sourceTaskFile = { kind: SourceTaskFileKind.Present, path }
  }
}
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
  if (sourceTaskFile.kind === SourceTaskFileKind.Missing) {
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
  const sourceTaskPath = realpathSync(resolve(sourceTaskFile.path))
  const sourceTaskRelativePath = relative(checkoutRoot, sourceTaskPath)
  const sourceTaskEscapesCheckout =
    sourceTaskRelativePath === '..' ||
    sourceTaskRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(sourceTaskRelativePath)
  if (
    sourceTaskRelativePath === '' ||
    !sourceTaskEscapesCheckout
  ) {
    console.error(
      'Refusing source-task file inside the public Nook checkout',
    )
    process.exit(8)
  }
  const sourceTask = readFileSync(sourceTaskPath, 'utf8')
  const rejection = validateAgentRecord(localContent, 'plan', [], sourceTask, {
    assignedGizmoId,
  })
  if (rejection) {
    console.error(`Refusing invalid Workbench plan: ${rejection}`)
    process.exit(7)
  }
  const currentGizmoId =
    /^- Current Gizmo ID:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(
      localContent,
    )?.[1] || ''
  const frontmatterGizmoId = parsePlanFrontmatterGizmoId(localContent)
  if (frontmatterGizmoId.kind === 'invalid') {
    console.error(`Refusing invalid Workbench plan: ${frontmatterGizmoId.message}`)
    process.exit(7)
  }
  if (frontmatterGizmoId.value !== currentGizmoId) {
    console.error(
      'Refusing invalid Workbench plan: YAML frontmatter gizmo_id must match the validated Current Gizmo ID',
    )
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
