import { type Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import { createLocalE2eFileSyncVaultStub } from '../file-sync-stub'
import { requireRecord } from './guards'

export type E2eOauthFileStub =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>

export enum ListGithubStubDirResultType {
  File = 'file',
  Dir = 'dir',
}

export enum GithubStubFailureScenario {
  None = 'none',
  UserUnauthorized = 'user-unauthorized',
  EventLogForbidden = 'event-log-forbidden',
}

export function listGithubStubDir(
  eventFiles: Map<string, string>,
  relativePath: string,
): Array<{
  name: string
  path: string
  type: ListGithubStubDirResultType.File | ListGithubStubDirResultType.Dir
}> {
  const dirPrefix = relativePath.endsWith('/')
    ? relativePath
    : `${relativePath}/`
  const dirs = new Set<string>()
  const files = new Set<string>()
  for (const storedPath of eventFiles.keys()) {
    if (!storedPath.startsWith(dirPrefix)) continue
    const rest = storedPath.slice(dirPrefix.length)
    const slash = rest.indexOf('/')
    if (slash >= 0) {
      dirs.add(rest.slice(0, slash))
    } else if (rest) {
      files.add(rest)
    }
  }
  return [
    ...[...dirs].sort().map((name) => ({
      name,
      path: `${relativePath}/${name}`,
      type: ListGithubStubDirResultType.Dir as const,
    })),
    ...[...files].sort().map((name) => ({
      name,
      path: `${relativePath}/${name}`,
      type: ListGithubStubDirResultType.File as const,
    })),
  ]
}

/** In-memory GitHub vault stub with GET/PUT support for local multi-device e2e. */
export function createLocalE2eGithubVaultStub(initialYaml = '') {
  let vaultYaml = initialYaml
  let revision = 0
  let sha = 'e2e-stub-sha-0'
  let failureScenario = GithubStubFailureScenario.None
  const failureResponses: Array<{
    method: string
    path: string
    status: number
  }> = []
  const eventFiles = new Map<string, string>()
  const eventShas = new Map<string, string>()
  const bumpSha = () => {
    revision += 1
    sha = `e2e-stub-sha-${revision}`
  }

  return {
    getVaultYaml: () => vaultYaml,
    getVaultRevision: () => revision,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
      bumpSha()
    },
    getEventFileCount: () => eventFiles.size,
    getEventFilePaths: () => [...eventFiles.keys()],
    getEventFileContents: () => [...eventFiles.values()],
    getFailureResponses: () => [...failureResponses],
    setFailureScenario: (scenario: GithubStubFailureScenario) => {
      failureScenario = scenario
      failureResponses.length = 0
    },
    clearEventFiles: () => {
      eventFiles.clear()
      eventShas.clear()
    },
    async install(
      page: Page,
      opts: { repoName: string; vaultYaml?: string; username?: string },
    ) {
      if (typeof opts.vaultYaml === 'string') {
        if (opts.vaultYaml !== vaultYaml) {
          bumpSha()
        }
        vaultYaml = opts.vaultYaml
      }
      const [owner = 'e2e-user'] = [opts.username]
      const fullRepo = `${owner}/${opts.repoName}`
      const context = page.context()

      const handler = async (route: import('@playwright/test').Route) => {
        const request = route.request()
        const [url = ''] = [request.url().split('?')[0]]
        const method = request.method()

        if (url === 'https://api.github.com/user') {
          if (failureScenario === GithubStubFailureScenario.UserUnauthorized) {
            failureResponses.push({ method, path: '/user', status: 401 })
            await route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Bad credentials' }),
            })
            return
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ login: owner }),
          })
          return
        }
        if (url === `https://api.github.com/repos/${fullRepo}`) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 1,
              name: opts.repoName,
              private: true,
              default_branch: 'main',
            }),
          })
          return
        }
        if (
          url.startsWith(`https://api.github.com/repos/${fullRepo}/git/trees/`)
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              tree: Array.from(eventFiles.keys()).map((path) => ({
                path,
                type: 'blob',
              })),
              truncated: false,
            }),
          })
          return
        }
        const contentsPrefix = `https://api.github.com/repos/${fullRepo}/contents/`
        if (url === contentsPrefix) {
          const files: Array<{ name: string; path: string; type: string }> = []
          if (vaultYaml.trim().length > 0) {
            files.push({
              name: 'nook-events',
              path: 'nook-events',
              type: ListGithubStubDirResultType.File,
            })
          }
          if (eventFiles.size > 0) {
            files.push({
              name: 'nook-log',
              path: 'nook-log',
              type: ListGithubStubDirResultType.Dir,
            })
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(files),
          })
          return
        }
        if (
          url ===
          `https://api.github.com/repos/${fullRepo}/contents/nook-events`
        ) {
          if (method === 'PUT') {
            const body = requireRecord(
              request.postDataJSON(),
              'GitHub upload request',
            )
            const hasExistingVault = vaultYaml.trim().length > 0
            if (hasExistingVault && body.sha !== sha) {
              await route.fulfill({
                status: body.sha ? 409 : 422,
                contentType: 'application/json',
                body: JSON.stringify({
                  message: 'sha does not match current file',
                }),
              })
              return
            }
            if (typeof body.content === 'string' && body.content) {
              vaultYaml = Buffer.from(body.content, 'base64').toString('utf8')
              bumpSha()
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: { sha },
              }),
            })
            return
          }
          if (!vaultYaml.trim()) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          const encoded = Buffer.from(vaultYaml, 'utf8').toString('base64')
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: encoded,
              sha,
              encoding: 'base64',
            }),
          })
          return
        }
        if (url.startsWith(`${contentsPrefix}nook-log/`)) {
          if (failureScenario === GithubStubFailureScenario.EventLogForbidden) {
            failureResponses.push({
              method,
              path: url.slice('https://api.github.com'.length),
              status: 403,
            })
            await route.fulfill({
              status: 403,
              contentType: 'application/json',
              body: JSON.stringify({
                message: 'Resource not accessible by integration',
              }),
            })
            return
          }
          const relativePath = url.slice(contentsPrefix.length)
          if (method === 'PUT') {
            const body = requireRecord(
              request.postDataJSON(),
              'GitHub event upload request',
            )
            if (typeof body.content === 'string' && body.content) {
              const decoded = Buffer.from(body.content, 'base64').toString(
                'utf8',
              )
              eventFiles.set(relativePath, decoded)
              eventShas.set(
                relativePath,
                `e2e-event-sha-${Date.now()}-${relativePath.length}`,
              )
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: {
                  sha: ((...[v = sha]) => v)(eventShas.get(relativePath)),
                },
              }),
            })
            return
          }
          const stored = eventFiles.get(relativePath)
          if (typeof stored === 'string') {
            const encoded = Buffer.from(stored, 'utf8').toString('base64')
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: encoded,
                sha: ((...[v = sha]) => v)(eventShas.get(relativePath)),
                encoding: 'base64',
              }),
            })
            return
          }
          const listing = listGithubStubDir(eventFiles, relativePath)
          if (listing.length === 0) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(listing),
          })
          return
        }
        if (method === 'PUT' && url.includes(`/repos/${fullRepo}/contents/`)) {
          sha = `e2e-stub-sha-${Date.now()}`
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ content: { sha } }),
          })
          return
        }
        await route.fallback()
      }

      await context.route('https://api.github.com/**', handler)
    },
  }
}
