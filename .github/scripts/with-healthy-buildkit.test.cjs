const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

test('keeps a job-scoped builder after its retry health probe succeeds', () => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'nook-buildkit-health-'))
  const dockerPath = join(fixtureDirectory, 'docker')
  const logPath = join(fixtureDirectory, 'docker.log')
  const probeMarkerPath = join(fixtureDirectory, 'first-probe')
  const dockerScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'printf "%s\\n" "$*" >> "$NOOK_TEST_DOCKER_LOG"',
    'if [ "$1 $2" = "buildx inspect" ]; then exit 0; fi',
    'if [ "$1 $2" = "buildx build" ]; then',
    '  if [ ! -e "$NOOK_TEST_PROBE_MARKER" ]; then touch "$NOOK_TEST_PROBE_MARKER"; exit 201; fi',
    '  exit 0',
    'fi',
    'exit 0',
  ].join('\n')
  writeFileSync(dockerPath, dockerScript)
  chmodSync(dockerPath, 0o755)

  try {
    const result = spawnSync(
      'bash',
      ['.github/scripts/with-healthy-buildkit.sh', '/usr/bin/true'],
      {
        cwd: join(__dirname, '..', '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER: dockerPath,
          NOOK_PR_BUILDX_BUILDER: 'job-builder',
          NOOK_TEST_DOCKER_LOG: logPath,
          NOOK_TEST_PROBE_MARKER: probeMarkerPath,
        },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /Retrying BuildKit health probe for job-builder/)
    const calls = readFileSync(logPath, 'utf8').trim().split('\n')
    assert.equal(calls.length, 5)
    assert.equal(calls[0], 'buildx inspect job-builder --bootstrap')
    assert.match(calls[1], /^buildx build --builder job-builder --file .+ --output type=cacheonly --progress=quiet .+$/)
    assert.equal(calls[2], 'buildx inspect job-builder --bootstrap')
    assert.match(calls[3], /^buildx build --builder job-builder --file .+ --output type=cacheonly --progress=quiet .+$/)
    assert.equal(calls[4], 'buildx use job-builder')
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true })
  }
})
