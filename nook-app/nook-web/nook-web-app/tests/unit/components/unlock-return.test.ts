import { describe, expect, test } from 'vitest'
import { UnlockReturn } from '$lib/app/unlock-return'
import { WorkspaceRoute } from '$lib/app/workspace-route'

describe('Open vault after unlocking from a panel', () => {
  test('returns once to the deep link the lock interrupted', () => {
    const unlockReturn = new UnlockReturn()
    unlockReturn.remember(WorkspaceRoute.Passwords)

    expect(unlockReturn.routeFrom(WorkspaceRoute.Identities)).toBe(
      WorkspaceRoute.Passwords,
    )
    expect(unlockReturn.routeFrom(WorkspaceRoute.Identities)).toBe(
      WorkspaceRoute.Vault,
    )
  })

  test('opens the vault when the unlock started on the identities page', () => {
    const unlockReturn = new UnlockReturn()
    unlockReturn.remember(WorkspaceRoute.Identities)

    expect(unlockReturn.routeFrom(WorkspaceRoute.Identities)).toBe(
      WorkspaceRoute.Vault,
    )
  })

  test('keeps nothing from a page outside the workspace', () => {
    const unlockReturn = new UnlockReturn()
    unlockReturn.remember(WorkspaceRoute.Passwords)
    unlockReturn.forget()

    expect(unlockReturn.routeFrom(WorkspaceRoute.Identities)).toBe(
      WorkspaceRoute.Vault,
    )
  })

  test('a workspace page the URL names wins over a kept deep link', () => {
    const unlockReturn = new UnlockReturn()
    unlockReturn.remember(WorkspaceRoute.Passwords)

    expect(unlockReturn.routeFrom(WorkspaceRoute.Sync)).toBe(
      WorkspaceRoute.Sync,
    )
    expect(unlockReturn.routeFrom(WorkspaceRoute.Identities)).toBe(
      WorkspaceRoute.Vault,
    )
  })
})
