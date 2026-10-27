import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  ExtensionPairedVaultUnlockRequestMessageType,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import type {
  CompanionIdentityDiscoveryObservation,
  CompanionIdentityStatus,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type PairedUnlockDemoDiscoveryMessage = Omit<
  ExtensionPairedVaultIdentityDiscoveryMessage,
  'payload'
> & {
  readonly payload: CompanionIdentityDiscoveryObservation
}

type PairedUnlockDemoMessage =
  | PairedUnlockDemoDiscoveryMessage
  | {
      readonly type: ExtensionPairedVaultUnlockRequestMessageType
      readonly payload: {
        readonly requestId: string
        readonly vaultStoreId: string
      }
    }

type PairedUnlockDemoRuntime = {
  sendMessage?: (
    extensionId: string,
    message: PairedUnlockDemoMessage,
    callback: (response?: unknown) => void,
  ) => void
}

type PairedUnlockDemoSimulation = {
  discoveryType: ExtensionPairedVaultIdentityDiscoveryMessageType
  unlockType: ExtensionPairedVaultUnlockRequestMessageType
  discoveryMs: number
}

/** Discoveries the page has asked the stubbed extension for. */
type PairedDiscoveryTally = {
  inFlight: number
  peak: number
  total: number
}

const DEMO_BEAT_MS = 700
/** Long enough for the page's own resume to retry beside the card's poll. */
const PAIRED_UNLOCK_WAIT_MS = 15_000

test('a locked vault asks its locked paired extension one discovery at a time while it waits for the unlock', async ({
  page,
}) => {
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  await connectLocalVault(page)
  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  // The extension keeps one handoff endpoint and each discovery replaces it,
  // so a discovery made while another is still answered would void the
  // handoff that follows it. The stub answers slowly to make any overlap
  // between the card's unlock and the page's own resume visible.
  const simulation: PairedUnlockDemoSimulation = {
    discoveryType:
      ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
    unlockType:
      ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
    discoveryMs: 400,
  }
  await page.addInitScript((demo) => {
    const tally: PairedDiscoveryTally = { inFlight: 0, peak: 0, total: 0 }
    // The page reads the tally back from its root element.
    const record = () => {
      document.documentElement?.setAttribute(
        'data-demo-discoveries',
        `${tally.total}/${tally.peak}`,
      )
    }
    const runtime: PairedUnlockDemoRuntime = {
      sendMessage: (_extensionId, message, callback) => {
        if (message.type === demo.unlockType) {
          callback({ ok: true, ...message.payload })
          return
        }
        if (message.type !== demo.discoveryType) {
          callback({ ok: false })
          return
        }
        const request = message.payload.request
        tally.inFlight += 1
        tally.total += 1
        tally.peak = Math.max(tally.peak, tally.inFlight)
        record()
        const status: CompanionIdentityStatus = {
          status: 'locked',
          request_id: String(request.requestId),
          vault_store_id: String(request.vaultStoreId),
        }
        setTimeout(() => {
          tally.inFlight -= 1
          callback({ ok: true, status })
        }, demo.discoveryMs)
      },
    }
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime },
    })
    // The init script can run before the page has its root element; the
    // extension's mark goes on it as soon as it exists, before the app reads it.
    const mark = () =>
      document.documentElement.setAttribute(
        'data-nook-extension-runtime-id',
        'demo-extension-id',
      )
    if (document.documentElement) {
      mark()
      return
    }
    const rootObserver = new MutationObserver(() => {
      if (!document.documentElement) return
      rootObserver.disconnect()
      mark()
    })
    rootObserver.observe(document, { childList: true })
  }, simulation)
  await page.reload()

  const row = page.getByTestId('identity-vault-row').first()
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  const unlock = page.getByTestId('vault-panel-unlock')
  await expect(unlock).toBeEnabled({ timeout: UI_TIMEOUT_MS })
  await unlock.click()

  // The card asks again every few hundred milliseconds and the page's own
  // resume retries on its timer; both wait their turn.
  const tally = async (): Promise<PairedDiscoveryTally> => {
    const recorded = await page
      .locator('html')
      .getAttribute('data-demo-discoveries')
    const [total = 0, peak = 0] = (recorded ?? '0/0').split('/').map(Number)
    return { inFlight: 0, peak, total }
  }
  await expect
    .poll(async () => (await tally()).total, {
      timeout: PAIRED_UNLOCK_WAIT_MS,
    })
    .toBeGreaterThanOrEqual(8)
  expect((await tally()).peak).toBe(1)
  await expect(page.getByTestId('vault-panel-unlock-error')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)
  if (directory) {
    await page.screenshot({
      path: `${directory}/vault-panel-paired-unlock-waiting.png`,
    })
  }
})
