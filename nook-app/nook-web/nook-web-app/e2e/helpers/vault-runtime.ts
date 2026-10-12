import { type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'

/**
 * Serial multi-device specs leave one browser idle while another acts; the e2e
 * idle timeout (2.5s) would auto-lock the waiting device and break sync flows.
 */
export async function disableVaultIdleLock(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: { stopIdleSessionTracking?: () => void }
      }
    ).__nookVault
    vault?.stopIdleSessionTracking?.()
  })
}

/** Wait for the wasm storage queue to drain; reset if it stalls (e2e dev build). */
export async function waitForStorageChainIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const drained = await page.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            waitForStorageChain?: () => Promise<void>
          }
        }
      ).__nookVault
      if (!vault?.waitForStorageChain) return true
      return Promise.race([
        vault.waitForStorageChain().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 500)
        }),
      ])
    })
    if (drained) return
  }
  await page.evaluate(() => {
    ;(
      window as Window & {
        __nookVault?: { resetStorageChain?: () => void }
      }
    ).__nookVault?.resetStorageChain?.()
  })
}
