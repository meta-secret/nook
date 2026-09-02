import { expect, test, vi } from 'vitest'
import type { SyncActionsContext } from '../../../../nook-web-shared/src/vault-app/lib/vault/action-contexts'
import { activateImportedProviderVaultIdentity } from '../../../../nook-web-shared/src/vault-app/lib/vault/sync-resolution'

test('completed import reports terminal identity activation failure separately', async () => {
  const activateIdentity = vi.fn(async () => {
    throw new Error('identity activation failed')
  })
  const state = {
    errorMsg: '',
    enqueueStorage: (operation: () => Promise<void>) => operation(),
    requireManager: () => ({ activate_local_identity: activateIdentity }),
    t: () => 'vault imported; identity selection failed',
  } as unknown as SyncActionsContext
  const request: Parameters<typeof activateImportedProviderVaultIdentity>[0] = {
    state,
    identityId: 'identity-personal',
  }

  await activateImportedProviderVaultIdentity(request)

  expect(activateIdentity).toHaveBeenCalledWith('identity-personal')
  expect(state.errorMsg).toBe('vault imported; identity selection failed')
})
