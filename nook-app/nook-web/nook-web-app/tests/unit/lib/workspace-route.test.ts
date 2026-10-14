import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  WorkspaceNavigationFailureKind,
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
  WorkspaceLocation,
  WorkspacePath,
} from '$lib/app/workspace-route'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('workspace routes', () => {
  test.each([
    ['/', WorkspaceRoute.Vault],
    ['/app/', WorkspaceRoute.Vault],
    ['/vault', WorkspaceRoute.Vault],
    ['/identities', WorkspaceRoute.Identities],
    ['/identity/keys', WorkspaceRoute.Keys],
    ['/identity/vaults/', WorkspaceRoute.Vaults],
    ['/identity/settings', WorkspaceRoute.Settings],
    ['/identity/devices', WorkspaceRoute.Devices],
    ['/identity/sync', WorkspaceRoute.Sync],
    ['/vault/passwords', WorkspaceRoute.Passwords],
    ['/vault/import', WorkspaceRoute.Import],
    ['/simple/identity/keys', WorkspaceRoute.Keys],
    ['/help', WorkspaceRoute.Help],
  ])('maps %s to its workspace', (pathname, route) => {
    expect(new WorkspacePath(pathname).route).toEqual({
      kind: WorkspaceRouteLookupKind.Workspace,
      route,
    })
  })

  test.each([
    ['/devices-access/', WorkspaceRoute.Keys],
    ['/simple/devices-access', WorkspaceRoute.Keys],
    ['/admin', WorkspaceRoute.Vaults],
    ['/onboard', WorkspaceRoute.Devices],
    ['/vault/devices', WorkspaceRoute.Devices],
    ['/vault/sync', WorkspaceRoute.Sync],
    ['/settings', WorkspaceRoute.Settings],
    ['/sentinel/settings', WorkspaceRoute.Settings],
  ])('keeps the earlier %s path working', (pathname, route) => {
    expect(new WorkspacePath(pathname).route).toEqual({
      kind: WorkspaceRouteLookupKind.Workspace,
      route,
    })
  })

  test('classifies unknown paths without guessing a workspace', () => {
    expect(new WorkspacePath('/vault/private-id').route).toEqual({
      kind: WorkspaceRouteLookupKind.Unknown,
    })
  })

  test.each([
    [WorkspaceRoute.Vault, '/vault'],
    [WorkspaceRoute.Identities, '/identities'],
    [WorkspaceRoute.Keys, '/identity/keys'],
    [WorkspaceRoute.Vaults, '/identity/vaults'],
    [WorkspaceRoute.Settings, '/identity/settings'],
    [WorkspaceRoute.Devices, '/identity/devices'],
    [WorkspaceRoute.Sync, '/identity/sync'],
    [WorkspaceRoute.Passwords, '/identity/passwords'],
    [WorkspaceRoute.Import, '/vault/import'],
    [WorkspaceRoute.Help, '/help'],
  ])('builds the canonical %s path', (route, path) => {
    expect(new WorkspaceLocation(route).path).toBe(path)
  })

  test('pushes a changed location and dispatches one popstate event', () => {
    window.history.replaceState({}, '', '/vault')
    const popstate = vi.fn()
    window.addEventListener('popstate', popstate, { once: true })

    const navigation = new WorkspaceLocation(WorkspaceRoute.Help).navigate()

    expect(navigation.isOk()).toBe(true)
    expect(window.location.pathname).toBe('/help')
    expect(popstate).toHaveBeenCalledOnce()
  })

  test('does not write history or dispatch when already at the destination', () => {
    window.history.replaceState({}, '', '/help')
    const pushState = vi.spyOn(window.history, 'pushState')
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')

    const navigation = new WorkspaceLocation(WorkspaceRoute.Help).navigate()

    expect(navigation.isOk()).toBe(true)
    expect(pushState).not.toHaveBeenCalled()
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  test.each(['history', 'event'])(
    'returns a typed failure for a %s failure',
    (stage) => {
      window.history.replaceState({}, '', '/vault')
      if (stage === 'history') {
        vi.spyOn(window.history, 'pushState').mockImplementation(() => {
          throw new Error('history failed')
        })
      } else {
        vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
          throw new Error('event failed')
        })
      }

      const navigation = new WorkspaceLocation(WorkspaceRoute.Help).navigate()

      expect(
        navigation.isErr() ? navigation.error.kind : navigation.value,
      ).toBe(WorkspaceNavigationFailureKind.HistoryUpdateFailed)
    },
  )

  // Simple and Sentinel build with a relative Vite base, so one bundle runs at
  // a domain root and under /simple/ or /sentinel/ in the preview harness.
  test.each([
    ['/identity/devices', '/identity/keys'],
    ['/vault/passwords', '/identity/keys'],
    ['/simple/identity/devices', '/simple/identity/keys'],
    ['/sentinel', '/sentinel/identity/keys'],
  ])('builds an absolute path from %s under a relative base', (from, path) => {
    vi.stubEnv('BASE_URL', './')
    window.history.replaceState({}, '', from)

    expect(new WorkspaceLocation(WorkspaceRoute.Keys).path).toBe(path)
  })

  test('moving between nested pages never stacks route segments', () => {
    vi.stubEnv('BASE_URL', './')
    window.history.replaceState({}, '', '/identity/devices')

    for (const route of [
      WorkspaceRoute.Sync,
      WorkspaceRoute.Settings,
      WorkspaceRoute.Passwords,
      WorkspaceRoute.Import,
      WorkspaceRoute.Vault,
    ]) {
      expect(new WorkspaceLocation(route).navigate().isOk()).toBe(true)
    }

    expect(window.location.pathname).toBe('/vault')
  })
})
