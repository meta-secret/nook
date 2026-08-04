import { describe, expect, test } from 'vitest'
import {
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
  workspacePath,
  workspaceRouteFromPath,
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
    expect(workspaceRouteFromPath(pathname)).toEqual({
      kind: WorkspaceRouteLookupKind.Workspace,
      route,
    })
  })

  test('classifies unknown paths without guessing a workspace', () => {
    expect(workspaceRouteFromPath('/vault/private-id')).toEqual({
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
    expect(workspacePath(route)).toBe(path)
  })
})
