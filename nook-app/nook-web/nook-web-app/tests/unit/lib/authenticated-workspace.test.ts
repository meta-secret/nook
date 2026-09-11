import { afterEach, describe, expect, test } from 'vitest'
import {
  AuthenticatedWorkspaceObservation,
  AuthenticatedWorkspaceState,
  type AuthenticatedWorkspaceVisibility,
} from '../../../e2e/helpers/authenticated-workspace'

afterEach(() => {
  document.body.replaceChildren()
})

describe('authenticated workspace observation', () => {
  test('admits the canonical shell when a stale route panel is hidden', () => {
    document.body.innerHTML = `
      <main data-testid="authenticated-shell"></main>
      <section data-testid="login-gate" hidden>
        <div data-testid="devices-access-dashboard"></div>
      </section>
    `
    const shell = document.querySelector<HTMLElement>(
      '[data-testid="authenticated-shell"]',
    )
    const loginGate = document.querySelector<HTMLElement>(
      '[data-testid="login-gate"]',
    )
    if (!shell || !loginGate) throw new Error('expected workspace fixture')

    const visibility: AuthenticatedWorkspaceVisibility = {
      authenticatedShellVisible: !shell.hidden,
      loginGateVisible: !loginGate.hidden,
    }
    const observation = new AuthenticatedWorkspaceObservation(visibility)

    expect(observation.state()).toBe(AuthenticatedWorkspaceState.Unlocked)
  })

  test('rejects a shell while the authentication gate is visible', () => {
    const visibility: AuthenticatedWorkspaceVisibility = {
      authenticatedShellVisible: true,
      loginGateVisible: true,
    }
    const observation = new AuthenticatedWorkspaceObservation(visibility)

    expect(observation.state()).toBe(AuthenticatedWorkspaceState.Locked)
  })
})
