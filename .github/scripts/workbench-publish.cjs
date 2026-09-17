#!/usr/bin/env node

const { execFileSync } = process.getBuiltinModule('node:child_process')
const { readFileSync } = process.getBuiltinModule('node:fs')

/** @typedef {{ kind: 'missing' } | { kind: 'present', sha: string }} WorkbenchRemoteFile */

const issuePathPattern =
  /^issues\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._-]+)*\.md$/

class WorkbenchIssuePublisher {
  /**
   * @param {string} repository
   * @param {string | undefined} expectedSha
   * @param {string | undefined} localPath
   * @param {string | undefined} remotePath
   * @param {string} message
   */
  constructor(repository, expectedSha, localPath, remotePath, message) {
    this.repository = repository
    this.expectedSha = expectedSha
    this.localPath = localPath
    this.remotePath = remotePath
    this.message = message
  }

  publish() {
    if (!this.localPath || !this.remotePath || !this.message) {
      console.error(
        'Usage: workbench-publish.cjs <local-file> <issues/<feature>/<issue>.md> <commit-message>',
      )
      return 2
    }
    if (!issuePathPattern.test(this.remotePath) || this.remotePath.includes('..')) {
      console.error('Refusing invalid Workbench issue path: ' + this.remotePath)
      return 2
    }

    const localContent = readFileSync(this.localPath, 'utf8')
    const content = Buffer.from(localContent).toString('base64')
    const remoteFile = this.readRemoteFile()

    if (remoteFile.kind === 'present' && !this.expectedSha) {
      console.error(
        'Refusing to overwrite mutable Workbench issue without NOOK_WORKBENCH_EXPECTED_SHA: ' +
          this.remotePath,
      )
      return 4
    }
    if (
      remoteFile.kind === 'present' &&
      remoteFile.sha !== this.expectedSha
    ) {
      console.error(
        'Refusing stale Workbench issue update for ' +
          this.remotePath +
          ': expected ' +
          this.expectedSha +
          ', current ' +
          remoteFile.sha,
      )
      return 5
    }

    const args = [
      'api',
      '--method',
      'PUT',
      'repos/' + this.repository + '/contents/' + this.remotePath,
      '-f',
      'message=' + this.message,
      '-f',
      'content=' + content,
      '-f',
      'branch=main',
    ]
    if (remoteFile.kind === 'present') {
      args.push('-f', 'sha=' + remoteFile.sha)
    }

    execFileSync('gh', args, { stdio: 'inherit' })
    return 0
  }

  /** @returns {WorkbenchRemoteFile} */
  readRemoteFile() {
    try {
      return {
        kind: 'present',
        sha: execFileSync(
          'gh',
          [
            'api',
            'repos/' + this.repository + '/contents/' + this.remotePath,
            '--jq',
            '.sha',
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim(),
      }
    } catch {
      /** @type {WorkbenchRemoteFile} */
      const missing = { kind: 'missing' }
      return missing
    }
  }
}

const repository =
  process.env.NOOK_WORKBENCH_REPOSITORY || 'meta-secret/nook-workbench'
const expectedSha = process.env.NOOK_WORKBENCH_EXPECTED_SHA?.trim()
const [localPath, remotePath, ...messageParts] = process.argv.slice(2)
const message = messageParts.join(' ').trim()
const publisher = new WorkbenchIssuePublisher(
  repository,
  expectedSha,
  localPath,
  remotePath,
  message,
)
process.exitCode = publisher.publish()
