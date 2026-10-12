import { type Locator } from '@playwright/test'
import {
  AuthenticatedWorkspaceObservation,
  AuthenticatedWorkspaceState,
  type AuthenticatedWorkspaceVisibility,
} from './authenticated-workspace'

export function isJoinerVaultReady(
  visibility: AuthenticatedWorkspaceVisibility,
): boolean {
  return (
    new AuthenticatedWorkspaceObservation(visibility).state() ===
    AuthenticatedWorkspaceState.Unlocked
  )
}

export async function tryJoinerQuickConnect(
  button: Pick<Locator, 'isVisible' | 'click'>,
  waitForIdle: () => Promise<void>,
): Promise<boolean> {
  if (!(await button.isVisible())) return false
  await button.click()
  await waitForIdle()
  return true
}
