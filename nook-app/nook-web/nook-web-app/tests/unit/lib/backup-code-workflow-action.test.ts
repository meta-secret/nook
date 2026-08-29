import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const mocks = vi.hoisted(() => ({
  recoveryCopy: vi.fn(() => 'Save these recovery codes'),
  revalidate: vi.fn(),
  startEnrollment: vi.fn(),
}))

vi.mock(
  '../../../../nook-web-extension/src/lib/backup-code-candidates',
  () => ({ authenticationRecoveryCopy: mocks.recoveryCopy }),
)
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-revalidation',
  () => ({
    AuthenticationObservationBindingKind: { Unbound: 'unbound' },
    performRevalidatedAuthenticationAction: mocks.revalidate,
  }),
)
vi.mock('../../../../nook-web-extension/src/content/enrollment-flow', () => ({
  startBackupCodeEnrollment: mocks.startEnrollment,
}))

import { startRevalidatedBackupCodeEnrollment } from '../../../../nook-web-extension/src/content/autofill/backup-code-workflow-action'

beforeEach(() => vi.clearAllMocks())

describe('backup-code workflow action', () => {
  test('extracts secrets only inside a fresh Rust-approved action', async () => {
    mocks.revalidate.mockImplementation(async (request) => request.act())
    const workflow = {
      root: document,
      formScope: { kind: 'unowned' },
      summary: {},
    }
    const host = { panel: document.createElement('section') }

    await expect(
      startRevalidatedBackupCodeEnrollment({ workflow, host } as never),
    ).resolves.toBe(true)

    expect(mocks.revalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAction: AuthenticationWorkflowAction.SaveBackupCodes,
        backupCodesCopy: 'Save these recovery codes',
      }),
    )
    expect(mocks.startEnrollment).toHaveBeenCalledWith({ host })
  })

  test('does not extract when Rust rejects the refreshed workflow', async () => {
    mocks.revalidate.mockResolvedValue(false)

    await expect(
      startRevalidatedBackupCodeEnrollment({
        workflow: {} as never,
        host: {} as never,
      }),
    ).resolves.toBe(false)
    expect(mocks.startEnrollment).not.toHaveBeenCalled()
  })
})
