import { expect, mock, test } from 'bun:test'
import { stopPendingSaveWatch } from '../src/content/autofill/login-save'
import {
  SavePageWatchKind,
  saveOfferState,
  type PendingSaveWatch,
} from '../src/content/autofill/state'
import { NookWebsiteLoginSaveDecision } from '../src/lib/login-save-messages'

test('pending login save watch stops at an authorization boundary', () => {
  const clearInterval = mock(() => {})
  Object.assign(globalThis, { window: { clearInterval } })
  const disconnect = mock(() => {})
  const watch: PendingSaveWatch = {
    offer: {
      offerId: 'pending-save-offer',
      decision: NookWebsiteLoginSaveDecision.Create,
      vaultStoreId: 'vault-store',
      vaultName: 'Personal',
    },
    startedAt: 1,
    authPath: '/login',
    sawMutation: false,
    timer: 7,
    observer: { disconnect } as MutationObserver,
  }
  saveOfferState.watchPage(watch)

  stopPendingSaveWatch()

  expect(clearInterval).toHaveBeenCalledWith(7)
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Idle)
})
