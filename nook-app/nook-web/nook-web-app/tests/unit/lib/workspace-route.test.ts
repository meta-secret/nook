import { describe, expect, test } from 'vitest'
import {
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
  WorkspaceLocation,
  WorkspacePath,
} from '$lib/app/workspace-route'

describe('workspace routes', () => {
  test.each([
    ['/', WorkspaceRoute.Vault],
    ['/app/', WorkspaceRoute.Vault],
    ['/vault', WorkspaceRoute.Vault],
    ['/devices-access/', WorkspaceRoute.DevicesAccess],
    ['/simple/devices-access', WorkspaceRoute.DevicesAccess],
    ['/sentinel/settings', WorkspaceRoute.Settings],
    ['/admin', WorkspaceRoute.Admin],
    ['/onboard', WorkspaceRoute.Onboard],
    ['/settings', WorkspaceRoute.Settings],
    ['/help', WorkspaceRoute.Help],
  ])('maps %s to its workspace', (pathname, route) => {
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
    [WorkspaceRoute.DevicesAccess, '/devices-access'],
    [WorkspaceRoute.Admin, '/admin'],
    [WorkspaceRoute.Onboard, '/onboard'],
    [WorkspaceRoute.Settings, '/settings'],
    [WorkspaceRoute.Help, '/help'],
  ])('builds the canonical %s path', (route, path) => {
    expect(new WorkspaceLocation(route).path).toBe(path)
  })
})
