import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import {
  LOCAL_S3_BUCKET,
  LOCAL_S3_ENDPOINT,
  LOCAL_S3_REGION,
  localS3Credentials,
  LocalS3Identity,
} from '../../../nook-web-extension/scripts/local-s3'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'
import { triggerVaultSyncRefresh } from './github-sync'
import { addSecret } from './secret-operations'
import { disableVaultIdleLock, uniqueSecretKey } from './vault-runtime'
import { createFirstRunKey, openVaultRow } from './vault-setup'
import { openVaultPage } from './workspace-navigation'

/** Where one test keeps its objects in the shared local S3 bucket, and the
 * fixture key it signs with. */
export type E2eS3Location = {
  readonly keyPrefix: string
  readonly identity: LocalS3Identity
}

/** A key prefix no other test uses: every test shares the local bucket, and
 * none lists or writes another's objects. */
export function uniqueS3KeyPrefix(flow: string): string {
  return `e2e/${flow}-${randomUUID()}`
}

/** Fill the S3 connection form with the local server, the location's prefix
 * and its fixture key, as a person types them. */
async function fillS3Connection(
  page: Page,
  location: E2eS3Location,
): Promise<void> {
  const key = localS3Credentials(location.identity)
  const fields: ReadonlyArray<readonly [string, string]> = [
    ['s3-endpoint-input', LOCAL_S3_ENDPOINT],
    ['s3-region-input', LOCAL_S3_REGION],
    ['s3-bucket-input', LOCAL_S3_BUCKET],
    ['s3-key-prefix-input', location.keyPrefix],
    ['s3-access-key-id-input', key.accessKeyId],
    ['s3-secret-access-key-input', key.secretAccessKey],
  ]
  for (const [testId, value] of fields) {
    await page.getByTestId(testId).fill(value)
  }
}

/** On first run's sync step, pick S3 and connect the local server with the
 * location's prefix and fixture key. */
export async function connectS3InFirstRun(
  page: Page,
  location: E2eS3Location,
): Promise<void> {
  await page.getByTestId('first-run-s3-option').click()
  await expect(page.getByTestId('first-run-s3-setup')).toBeVisible()
  await fillS3Connection(page, location)
  await page.getByTestId('first-run-s3-connect').click()
}

/** On the recovery screen's provider picker, pick S3 and connect the local
 * server with the location's prefix and fixture key. */
export async function connectS3OnRecoveryScreen(
  page: Page,
  location: E2eS3Location,
): Promise<void> {
  await page.getByTestId('provider-option-s3').click()
  await expect(page.getByTestId('s3-setup')).toBeVisible()
  await fillS3Connection(page, location)
  await page.getByTestId('connect-provider-btn').click()
}

/** On an unlocked identity that keeps its vaults on this browser only, add
 * S3 from its card's protection checklist: the copy step opens the provider
 * picker, and S3 connects the local server with the location's key. */
export async function addS3FromProtection(
  page: Page,
  location: E2eS3Location,
): Promise<void> {
  const protection = page.getByTestId('identity-protection-toggle')
  await expect(protection).toContainText('0 of 3 done')
  await protection.click()
  await page.getByTestId('identity-protection-action').click()
  await page.getByTestId('provider-option-s3').click()
  await expect(page.getByTestId('s3-setup')).toBeVisible()
  await fillS3Connection(page, location)
  await page.getByTestId('connect-provider-btn').click()
}

/** On a connected S3 location that holds no keyring yet, create one under
 * `name`. Its first vault is made on this browser, the Connect step saves S3
 * and syncs it, and setup ends with that vault open on the keyring's card. */
export async function createKeyringOnS3(
  page: Page,
  name: string,
): Promise<void> {
  await expect(page.getByTestId('first-run-identities-empty')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('first-run-create-new-identity').click()
  const nameInput = page.getByTestId('first-run-identity-name-input')
  await expect(nameInput).toBeEnabled()
  await nameInput.fill(name)
  await page.getByTestId('first-run-identity-create-btn').click()
  await expect(openVaultRow(page)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** A keyring one app keeps on S3 under a test's own prefix, with the
 * secret its first vault takes. */
export type S3KeptKeyring = {
  readonly keyPrefix: string
  readonly keyringName: string
  readonly secretValue: string
}

/** The secret a keyring's first vault keeps on S3. */
export type S3KeptSecret = {
  readonly key: string
  readonly value: string
}

/** A fresh app's first run on S3: its passkey, the location with device A's
 * key, a new keyring whose vault takes one secret, then Sync now, so the
 * vault's events are on S3 before another app reads them. */
export async function keepSecretOnS3(
  page: Page,
  kept: S3KeptKeyring,
): Promise<S3KeptSecret> {
  await page.goto('/app/')
  await createFirstRunKey(page)
  await connectS3InFirstRun(page, {
    keyPrefix: kept.keyPrefix,
    identity: LocalS3Identity.DeviceA,
  })
  await createKeyringOnS3(page, kept.keyringName)
  await disableVaultIdleLock(page)
  await openVaultPage(page)
  const secret: S3KeptSecret = {
    key: uniqueSecretKey('s3-secret'),
    value: kept.secretValue,
  }
  await addSecret(page, secret.key, secret.value)
  await triggerVaultSyncRefresh(page)
  return secret
}
