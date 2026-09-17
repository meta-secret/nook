#!/usr/bin/env node

const { execFileSync } = process.getBuiltinModule('node:child_process')
const { readFileSync } = process.getBuiltinModule('node:fs')

const WorkbenchRemoteFileKind = Object.freeze({
  Missing: 'missing',
  Present: 'present',
})
/** @typedef {{ kind: typeof WorkbenchRemoteFileKind.Missing } | { kind: typeof WorkbenchRemoteFileKind.Present, sha: string }} WorkbenchRemoteFile */

const WorkbenchPublishArgumentKind = Object.freeze({
  Missing: 'missing',
  Present: 'present',
})
/** @typedef {{ kind: typeof WorkbenchPublishArgumentKind.Missing } | { kind: typeof WorkbenchPublishArgumentKind.Present, value: string }} WorkbenchPublishArgument */

const WorkbenchExpectedShaKind = Object.freeze({
  Omitted: 'omitted',
  Specified: 'specified',
})
/** @typedef {{ kind: typeof WorkbenchExpectedShaKind.Omitted } | { kind: typeof WorkbenchExpectedShaKind.Specified, value: string }} WorkbenchExpectedSha */

const issuePathPattern =
  /^issues\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._-]+)*\.md$/

class WorkbenchIssuePublisher {
  /**
   * @param {string} repository
   * @param {WorkbenchExpectedSha} expectedSha
   * @param {WorkbenchPublishArgument} localPath
   * @param {WorkbenchPublishArgument} remotePath
   * @param {WorkbenchPublishArgument} message
   */
  constructor(repository, expectedSha, localPath, remotePath, message) {
    this.repository = repository
    this.expectedSha = expectedSha
    this.localPath = localPath
    this.remotePath = remotePath
    this.message = message
  }

  publish() {
    if (
      this.localPath.kind === WorkbenchPublishArgumentKind.Missing ||
      this.remotePath.kind === WorkbenchPublishArgumentKind.Missing ||
      this.message.kind === WorkbenchPublishArgumentKind.Missing
    ) {
      console.error(
        'Usage: workbench-publish.cjs <local-file> <issues/<feature>/<issue>.md> <commit-message>',
      )
      return 2
    }

    const localPath = this.localPath.value
    const remotePath = this.remotePath.value
    const message = this.message.value
    if (!issuePathPattern.test(remotePath) || remotePath.includes('..')) {
      console.error('Refusing invalid Workbench issue path: ' + remotePath)
      return 2
    }

    const localContent = readFileSync(localPath, 'utf8')
    const content = Buffer.from(localContent).toString('base64')
    const remoteFile = this.readRemoteFile(remotePath)

    if (
      remoteFile.kind === WorkbenchRemoteFileKind.Present &&
      this.expectedSha.kind === WorkbenchExpectedShaKind.Omitted
    ) {
      console.error(
        'Refusing to overwrite mutable Workbench issue without NOOK_WORKBENCH_EXPECTED_SHA: ' +
          remotePath,
      )
      return 4
    }
    if (
      remoteFile.kind === WorkbenchRemoteFileKind.Present &&
      this.expectedSha.kind === WorkbenchExpectedShaKind.Specified &&
      remoteFile.sha !== this.expectedSha.value
    ) {
      console.error(
        'Refusing stale Workbench issue update for ' +
          remotePath +
          ': expected ' +
          this.expectedSha.value +
          ', current ' +
          remoteFile.sha,
      )
      return 5
    }

    const args = [
      'api',
      '--method',
      'PUT',
      'repos/' + this.repository + '/contents/' + remotePath,
      '-f',
      'message=' + message,
      '-f',
      'content=' + content,
      '-f',
      'branch=main',
    ]
    if (remoteFile.kind === WorkbenchRemoteFileKind.Present) {
      args.push('-f', 'sha=' + remoteFile.sha)
    }

    execFileSync('gh', args, { stdio: 'inherit' })
    return 0
  }

  /** @param {string} remotePath @returns {WorkbenchRemoteFile} */
  readRemoteFile(remotePath) {
    try {
      return {
        kind: WorkbenchRemoteFileKind.Present,
        sha: execFileSync(
          'gh',
          [
            'api',
            'repos/' + this.repository + '/contents/' + remotePath,
            '--jq',
            '.sha',
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim(),
      }
    } catch {
      return { kind: WorkbenchRemoteFileKind.Missing }
    }
  }
}

const cliArguments = process.argv.slice(2)
/** @type {WorkbenchPublishArgument} */
let localPath = { kind: WorkbenchPublishArgumentKind.Missing }
/** @type {WorkbenchPublishArgument} */
let remotePath = { kind: WorkbenchPublishArgumentKind.Missing }
const messageParts = []
let argumentPosition = 0
for (const argument of cliArguments) {
  if (argumentPosition === 0 && argument.length > 0) {
    localPath = { kind: WorkbenchPublishArgumentKind.Present, value: argument }
  } else if (argumentPosition === 1 && argument.length > 0) {
    remotePath = { kind: WorkbenchPublishArgumentKind.Present, value: argument }
  } else if (argumentPosition >= 2) {
    messageParts.push(argument)
  }
  argumentPosition += 1
}

const messageValue = messageParts.join(' ').trim()
/** @type {WorkbenchPublishArgument} */
const message =
  messageValue.length > 0
    ? { kind: WorkbenchPublishArgumentKind.Present, value: messageValue }
    : { kind: WorkbenchPublishArgumentKind.Missing }

let repository = 'meta-secret/nook-workbench'
/** @type {WorkbenchExpectedSha} */
let expectedSha = { kind: WorkbenchExpectedShaKind.Omitted }
for (const [name, value] of Object.entries(process.env)) {
  if (name === 'NOOK_WORKBENCH_REPOSITORY' && value.length > 0) {
    repository = value
  }
  if (name === 'NOOK_WORKBENCH_EXPECTED_SHA') {
    const expectedShaValue = value.trim()
    if (expectedShaValue.length > 0) {
      expectedSha = {
        kind: WorkbenchExpectedShaKind.Specified,
        value: expectedShaValue,
      }
    }
  }
}

const publisher = new WorkbenchIssuePublisher(
  repository,
  expectedSha,
  localPath,
  remotePath,
  message,
)
process.exitCode = publisher.publish()
