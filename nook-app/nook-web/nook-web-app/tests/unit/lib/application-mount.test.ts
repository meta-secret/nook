import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppLogsLocation } from '$lib/app/logs-api'
import {
  WorkspaceLocation,
  WorkspacePath,
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
} from '$lib/app/workspace-route'
import {
  ApplicationRoutePresentation,
  LegalPageId,
  LegalPageLookupKind,
} from '$lib/content/legal'

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState({}, '', '/')
})

describe('application mount', () => {
  test.each([
    { base: './', mount: '' },
    { base: './', mount: '/simple' },
    { base: './', mount: '/sentinel' },
    { base: '/preview/', mount: '/preview' },
  ])('round-trips links under $base at "$mount"', ({ base, mount }) => {
    vi.stubEnv('BASE_URL', base)
    window.history.replaceState({}, '', `${mount}/identity/keys`)

    const logs = new ApplicationRoutePresentation('/logs').appPath()
    const appLogs = new ApplicationRoutePresentation('/app-logs').appPath()
    expect(logs).toBe(`${mount}/logs`)
    expect(appLogs).toBe(`${mount}/app-logs`)
    expect(new ApplicationRoutePresentation(logs).isLogsPath()).toBe(true)
    expect(new AppLogsLocation(`${appLogs}/`).matches).toBe(true)
    expect(
      new ApplicationRoutePresentation(
        `${mount}/terms/`,
      ).getLegalPageFromPath(),
    ).toEqual({ kind: LegalPageLookupKind.LegalPage, page: LegalPageId.Terms })
    const settings = new WorkspaceLocation(WorkspaceRoute.Settings).path
    expect(settings).toBe(`${mount}/identity/settings`)
    expect(new WorkspacePath(settings).route).toEqual({
      kind: WorkspaceRouteLookupKind.Workspace,
      route: WorkspaceRoute.Settings,
    })
  })

  test.each([
    { base: './', path: '/simplex/logs' },
    { base: './', path: '/sentinel-old/logs' },
    { base: './', path: '/simple/sentinel/logs' },
    { base: '/preview/', path: '/previewer/logs' },
    { base: '/', path: '/simple/logs' },
  ])('rejects a foreign or repeated mount at $path', ({ base, path }) => {
    vi.stubEnv('BASE_URL', base)
    expect(new ApplicationRoutePresentation(path).isLogsPath()).toBe(false)
  })
})
