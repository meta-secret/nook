// @vitest-environment node

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  GITHUB_PROVIDER_ROOT,
  GITHUB_VAULT_PATH,
} from '../../../e2e/github-api'
import {
  waitForGithubVaultProjectionState,
  waitForVaultYaml,
} from '../../../e2e/helpers'

const eventDigest = 'A'.repeat(43)
const identityDir = `${GITHUB_PROVIDER_ROOT}/idn_observeride`
const vaultDir = `${identityDir}/store_observervau`
const eventsDir = `${vaultDir}/events`
const eventPath = `${eventsDir}/${eventDigest}.yaml`
const contents = 'https://api.github.com/repos/owner/observer-test/contents'
const eventYaml = `created_at: 2026-09-12T00:00:00Z
operations:
  - type: secret-created
    secret:
      id: observed-secret
      type: login
      ciphertext: encrypted-value
`

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('waitForVaultYaml GitHub observer', () => {
  test('lists and fetches canonical event files instead of the projection path', async () => {
    const requests: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requests.push(url)
      if (url === 'https://api.github.com/user') {
        return response({ login: 'owner' })
      }
      // The repository files each vault under the identity that wrote it.
      const listings = new Map<string, unknown[]>([
        [
          `${contents}/${GITHUB_PROVIDER_ROOT}`,
          [{ name: 'idn_observeride', path: identityDir, type: 'dir' }],
        ],
        [
          `${contents}/${identityDir}`,
          [
            { name: 'log', path: `${identityDir}/log`, type: 'dir' },
            { name: 'store_observervau', path: vaultDir, type: 'dir' },
          ],
        ],
        [
          `${contents}/${eventsDir}`,
          [{ name: `${eventDigest}.yaml`, path: eventPath, type: 'file' }],
        ],
      ])
      const listing = listings.get(url)
      if (listing) return response(listing)
      if (
        url ===
        `https://api.github.com/repos/owner/observer-test/contents/${eventPath}`
      ) {
        return response({ content: Buffer.from(eventYaml).toString('base64') })
      }
      throw new Error(`unexpected GitHub request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await waitForVaultYaml(
      'test-pat',
      'observer-test',
      (candidate) => candidate.secretIds.includes('observed-secret'),
      { timeoutMs: 1_000, intervalMs: 1 },
    )

    expect(snapshot.secretIds).toEqual(['observed-secret'])
    expect(requests).toContain(`${contents}/${eventsDir}`)
    // An identity's control log is never read as vault events.
    expect(requests).not.toContain(`${contents}/${identityDir}/log/events`)
    expect(requests).toContain(
      `https://api.github.com/repos/owner/observer-test/contents/${eventPath}`,
    )
    expect(requests).not.toContain(
      'https://api.github.com/repos/owner/observer-test/contents/nook-events',
    )
  })

  test('waits for a stale projection to catch up before taking a deletion baseline', async () => {
    const projectionYamls: [string, string] = [
      'secrets: []',
      `secrets:
  - id: existing-secret
    type: login
    data: encrypted-value`,
    ]
    let projectionReads = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/user') {
        return response({ login: 'owner' })
      }
      if (
        url ===
        `https://api.github.com/repos/owner/projection-test/contents/${GITHUB_VAULT_PATH}`
      ) {
        const yaml =
          projectionReads++ === 0 ? projectionYamls[0] : projectionYamls[1]
        return response({ content: Buffer.from(yaml).toString('base64') })
      }
      throw new Error(`unexpected GitHub request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await waitForGithubVaultProjectionState(
      'test-pat',
      'projection-test',
      (candidate) => candidate.secretIds.length > 0,
      { timeoutMs: 1_000, intervalMs: 1 },
    )

    expect(snapshot.secretIds).toEqual(['existing-secret'])
    expect(projectionReads).toBe(2)
  })
})
