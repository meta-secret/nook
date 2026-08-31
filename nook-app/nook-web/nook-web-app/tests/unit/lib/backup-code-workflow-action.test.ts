import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  startEnrollment: vi.fn(),
}))
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-revalidation',
  () => ({
    AuthenticationObservationBindingKind: { Unbound: 'unbound' },
    RevalidatedAuthenticationActionOutcomeKind: { Acted: 'acted' },
    RevalidatedAuthenticationActResultKind: { Acted: 'acted' },
    performRevalidatedAuthenticationAction: mocks.revalidate,
  }),
)
import { startRevalidatedEnrollmentAction } from '../../../../nook-web-extension/src/content/autofill/backup-code-workflow-action'
beforeEach(() => vi.clearAllMocks())
describe('backup-code workflow action', () => {
  function connectedHost() {
    let busy = false
    const panel = document.createElement('section')
    document.body.append(panel)
    return {
      panel,
      isBusy: () => busy,
      setBusy: (value: boolean) => {
        busy = value
      },
    }
  }
  test('starts extraction only inside a fresh Rust-approved action', async () => {
    mocks.revalidate.mockImplementation(async (request) => request.act())
    const workflow = {
      root: document,
      formScope: { kind: 'unowned' },
      summary: {},
    }
    const host = connectedHost()
    await expect(
      startRevalidatedEnrollmentAction({
        workflow,
        host,
        action: AuthenticationWorkflowAction.SaveBackupCodes,
        start: mocks.startEnrollment,
      } as never),
    ).resolves.toBe(true)
    expect(mocks.revalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAction: AuthenticationWorkflowAction.SaveBackupCodes,
      }),
    )
    expect(mocks.startEnrollment).toHaveBeenCalledOnce()
  })
  test('does not extract when Rust rejects the refreshed workflow', async () => {
    mocks.revalidate.mockResolvedValue(false)
    await expect(
      startRevalidatedEnrollmentAction({
        workflow: {} as never,
        host: connectedHost() as never,
        action: AuthenticationWorkflowAction.SaveBackupCodes,
        start: mocks.startEnrollment,
      }),
    ).resolves.toBe(false)
    expect(mocks.startEnrollment).not.toHaveBeenCalled()
  })
  test('rejects a second approval while revalidation is pending', async () => {
    let release: () => void = () => {
      throw new Error('revalidation release was not installed')
    }
    mocks.revalidate.mockImplementation(
      () =>
        new Promise<{ kind: string }>((resolve) => {
          release = () => resolve({ kind: 'rejected' })
        }),
    )
    const host = connectedHost()
    const request = {
      workflow: {
        root: document,
        formScope: { kind: 'unowned' },
        summary: {},
      },
      host,
      action: AuthenticationWorkflowAction.SaveBackupCodes,
      start: mocks.startEnrollment,
    }
    const first = startRevalidatedEnrollmentAction(request as never)
    await expect(
      startRevalidatedEnrollmentAction(request as never),
    ).resolves.toBe(false)
    expect(mocks.revalidate).toHaveBeenCalledOnce()
    release?.()
    await first
  })
})
