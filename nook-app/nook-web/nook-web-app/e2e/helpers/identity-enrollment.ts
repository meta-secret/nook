import { expect, type Page } from '@playwright/test'
import type { VaultDebugWindow } from '$lib/app/browser-lifecycle'
import { dumpNookLogs } from './app-logs'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import {
  clearBrowserVault,
  disableVaultIdleLock,
  waitForVaultOperationsIdle,
  waitForVaultUnlocked,
} from './vault-runtime'
import {
  ManagePage,
  openManagePage,
  openVaultPage,
} from './workspace-navigation'
import {
  localizeAppLinkForE2e,
  openOnboardDevicePanel,
  submitOnboardEnrollmentCode,
} from './onboard-invite'

/** One-time passphrase e2e members share with an identity enrollment code. */
export const E2E_IDENTITY_PASSPHRASE = 'e2e-identity-passphrase'

/** Identity code a member issued on the Devices page. */
export type IssuedIdentityCode = {
  readonly link: string
  readonly passphrase: string
}

/** Issue an identity enrollment code from the add-device flow. */
export async function issueIdentityEnrollmentCode(
  page: Page,
  passphrase = E2E_IDENTITY_PASSPHRASE,
): Promise<IssuedIdentityCode> {
  await openOnboardDevicePanel(page)
  await submitOnboardEnrollmentCode(page, passphrase)
  const linkText = await page.getByTestId('onboard-link').textContent()
  if (typeof linkText !== 'string') {
    throw new Error('onboarding link text was not available.')
  }
  const link = linkText.trim()
  expect(link).toContain('#enroll=')
  return { link, passphrase }
}

/** The joining app redeems the code and signs itself into the identity. */
export async function redeemIdentityEnrollmentCode(
  page: Page,
  passphrase: string,
): Promise<void> {
  await expect(page.getByTestId('join-this-device')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.getByTestId('enrollment-password-input').fill(passphrase)
  await page.getByTestId('submit-enrollment-code-btn').click()
  const joined = page.getByTestId('identity-join-ready')
  const failure = page.getByTestId('vault-error')
  try {
    await expect(joined.or(failure).first()).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    if (await failure.isVisible()) {
      throw new Error(
        `identity join failed: ${(await failure.innerText()).trim()}`,
      )
    }
  } catch (error) {
    await dumpNookLogs(page, 'redeemIdentityEnrollmentCode')
    console.log(
      `[redeemIdentityEnrollmentCode] browser errors:\n${consoleErrors.join('\n')}`,
    )
    throw error
  }
}

/** A member syncs its identity log until the invited app shows among its
 * devices. No member approves the join. */
export async function expectIdentityMembers(
  page: Page,
  expectedMembers: number,
): Promise<void> {
  await openManagePage(page, ManagePage.Devices)
  const rows = page.getByTestId('vault-member-row')
  await expect
    .poll(
      async () => {
        if ((await rows.count()) === expectedMembers) return true
        await page.getByTestId('identity-sync-now-btn').click()
        await waitForVaultOperationsIdle(page)
        return (await rows.count()) === expectedMembers
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
}

/** The joined app opens the vault its invite granted. */
export async function openVaultAfterIdentityJoin(page: Page): Promise<void> {
  const openVault = page.getByTestId('identity-open-vault-btn').first()
  try {
    await expect(openVault).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  } catch (error) {
    const state = await page.evaluate(() => {
      const vault = (window as VaultDebugWindow).__nookVault
      return JSON.stringify({
        error: vault?.errorMsg,
        snapshot: vault?.identityControl?.snapshot,
        join: vault?.identityControl?.join,
      })
    })
    console.log(`[openVaultAfterIdentityJoin] joiner state: ${state}`)
    await dumpNookLogs(page, 'openVaultAfterIdentityJoin')
    throw error
  }
  // Every unlock starts a new idle tracker; keep the e2e idle lock off.
  await keepVaultIdleLockDisabled(page)
  await openVault.click()
  await waitForVaultUnlocked(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
  await disableVaultIdleLock(page)
}

/** Named values required by `joinIdentityThroughCode`. */
export type IdentityJoinThroughCode = {
  readonly member: Page
  readonly joiner: Page
  readonly expectedMembers: number
}

/**
 * Join a fresh app to the member's identity: issue a code, redeem it on the
 * joiner, which signs itself in, and open the vault on the joiner. The member
 * returns to its vault page.
 */
export async function joinIdentityThroughCode({
  member,
  joiner,
  expectedMembers,
}: IdentityJoinThroughCode): Promise<void> {
  const issued = await issueIdentityEnrollmentCode(member)
  await joiner.goto('/app/')
  await clearBrowserVault(joiner)
  await joiner.goto(localizeAppLinkForE2e(member, issued.link))
  await expect(joiner.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await redeemIdentityEnrollmentCode(joiner, issued.passphrase)
  await openVaultAfterIdentityJoin(joiner)
  await expectIdentityMembers(member, expectedMembers)
  await openVaultPage(member)
}
