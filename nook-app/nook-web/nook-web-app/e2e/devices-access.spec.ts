import { expect, test } from './fixtures'
import { DeviceAccessProtectionKind, NookDeviceAccessTextKind } from '$app-wasm'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from './helpers'

enum PreviewTextKind {
  Missing = 'missing',
  Present = 'present',
}

test.describe('devices and access dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('is available before any vault and lets the suggestion stay dismissed', async ({
    page,
  }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('devices-access-nudge')).toBeVisible()
    await page.getByTestId('devices-access-nudge-review').click()
    await expect(page.getByTestId('devices-access-back')).toBeFocused()
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('devices-access-nudge-review')).toBeFocused()

    // Dismissing removes the whole suggestion, so the checkbox never settles
    // into a checked state Playwright could verify with `check()`.
    await page.getByTestId('devices-access-dont-show-again').click()
    await expect(page.getByTestId('devices-access-nudge')).toBeHidden()
    await expect(page.getByTestId('login-devices-access')).toBeFocused()

    await page.getByTestId('login-devices-access').click()
    await expect(page.getByTestId('devices-access-back')).toBeFocused()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible()
    await expect(dashboard).toContainText('Not prepared')
    // An unprepared browser previews the same three bands it will populate
    // instead of offering evidence it cannot have yet.
    const preview = page.getByTestId('devices-access-chain-preview')
    await expect(preview).toContainText('My browser')
    await expect(preview).toContainText('My identities')
    await expect(preview).toContainText('Vault access')
    await expect(preview).toContainText('unlocks')
    await expect(preview).toContainText('opens')
    // DOM order matters here; innerText applies the micro-label's visual
    // uppercase transform and would make the source-case labels unsearchable.
    const previewTextState = await preview.evaluate((element, kind) => {
      const text = element.textContent
      return typeof text === 'string'
        ? { kind: kind.Present, text }
        : { kind: kind.Missing }
    }, PreviewTextKind)
    if (previewTextState.kind === PreviewTextKind.Missing) {
      throw new Error('Devices & access preview has no text content')
    }
    const previewText = previewTextState.text
    expect(previewText.indexOf('No browser identity')).toBeLessThan(
      previewText.indexOf('My browser'),
    )
    expect(previewText.indexOf('My browser')).toBeLessThan(
      previewText.indexOf('Vault access'),
    )
    await expect(preview).not.toContainText('Passkey')
    await expect(preview).toContainText('No browser identity')
    await expect(preview).toContainText('No local vaults yet')
    await expect(page.getByTestId('devices-access-chain')).toHaveCount(0)
    await expect(
      page.getByTestId('devices-access-prepare-browser'),
    ).toBeVisible()

    await page.getByTestId('device-protection-create-new-choice').click()
    await page
      .getByTestId('device-protection-label-input')
      .fill('Dashboard focus passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('devices-access-node-unlock')).toBeFocused({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(dashboard).toContainText(
      'Create or connect a vault to see its access here',
    )
    await expect(dashboard).not.toContainText(
      'prepare this browser identity first',
    )
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('login-devices-access')).toBeFocused()

    await page.reload()
    await expect(page.getByTestId('devices-access-nudge')).toHaveCount(0)
    await expect(page.getByTestId('login-devices-access')).toBeVisible()
  })

  test('walks the access chain from passkey to device key to vaults', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await expect(page.getByTestId('devices-access-nudge')).toHaveCount(0)
    await addVaultPassword(
      page,
      'Emergency recovery',
      'correct horse battery staple',
    )

    await page.getByTestId('vault-devices-access-tab').click()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity unlocked')
    await expect(
      page.getByTestId('devices-access-node-device-key'),
    ).toContainText('Passkey · recoverable identity')

    const unlockNode = page.getByTestId('devices-access-node-unlock')
    const deviceKeyNode = page.getByTestId('devices-access-node-device-key')
    const vaultsNode = page.getByTestId('devices-access-node-vaults')
    await expect(
      page.getByTestId('devices-access-chain').locator('[role="tablist"]'),
    ).toHaveAttribute('aria-orientation', 'vertical')
    await expect(page.getByTestId('devices-access-chain')).toContainText(
      'unlocks',
    )
    await expect(unlockNode).toHaveAttribute('aria-selected', 'true')
    await expect(deviceKeyNode).toContainText('This browser')
    await expect(vaultsNode).toContainText('1 of 1')
    const strengthVaults = page.getByTestId('devices-access-strength-vaults')
    await expect(strengthVaults).toHaveCount(0)
    // The drawn connector is decorative, so each link's own name has to carry
    // the relation for anyone who never sees the schematic.
    await expect(deviceKeyNode).toHaveAccessibleName(/unlocks/)
    await expect(deviceKeyNode).toHaveAccessibleName(/My browser/)
    await expect(deviceKeyNode).toHaveAccessibleName(/Identity unlocked/)
    await expect(deviceKeyNode).toHaveAccessibleName(
      /Passkey · recoverable identity/,
    )
    await expect(deviceKeyNode).toHaveAccessibleName(/Verified vaults: 1 of 1/)
    await expect(vaultsNode).toHaveAccessibleName(/opens/)
    await expect(vaultsNode).toHaveAccessibleName(/Vault access/)
    await expect(unlockNode).toContainText('Named by you')
    await expect(unlockNode).toHaveAccessibleName(/Named by you/)
    await expect(unlockNode).toHaveAccessibleName(/Verified vaults: 1 of 1/)

    // The first link opens selected: one passkey fingerprint, and the same
    // fingerprint on its node, so the relationship and the evidence agree.
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Passkey · recoverable identity')
    const credentialFingerprint = await page
      .getByTestId('devices-access-credential-id')
      .innerText()
    expect(credentialFingerprint).not.toBe('Unknown')
    await expect(unlockNode).toHaveAccessibleName(
      new RegExp(credentialFingerprint),
    )
    await expect(unlockNode).toContainText(credentialFingerprint.slice(-8))
    const aaguidRow = panel.getByText('Authenticator AAGUID', { exact: true })
    await expect(aaguidRow).toBeHidden()
    await page.getByTestId('devices-access-browser-reported').click()
    await expect(aaguidRow).toBeVisible()
    await expect(panel).toContainText('Built into this platform')
    await expect(panel).toContainText('Backed up or synced')
    await expect(panel).toContainText('Nearby device or phone')
    await expect(panel).toContainText('Built into this device')
    await expect(panel).not.toContainText('hybrid, internal')
    await expect(panel).toContainText('01010101-0101-0101-0101-010101010101')

    // Arrow keys follow the map's visible order, and the panel follows focus.
    await deviceKeyNode.press('ArrowRight')
    await expect(unlockNode).toBeFocused()
    await expect(unlockNode).toHaveAttribute('aria-selected', 'true')

    await unlockNode.press('ArrowRight')
    await expect(vaultsNode).toBeFocused()
    await expect(vaultsNode).toHaveAttribute('aria-selected', 'true')
    await expect(panel).toContainText('Vaults known to this device key')
    await expect(strengthVaults).toContainText('Opens here')
    await expect(strengthVaults).toContainText('Verified way in')
    await expect(strengthVaults).toContainText('This browser')
    await expect(
      page
        .getByTestId('devices-access-chain')
        .locator('[role="tablist"]')
        .getByTestId('devices-access-strength-vaults'),
    ).toHaveCount(0)

    await vaultsNode.press('ArrowLeft')
    await expect(unlockNode).toBeFocused()
    await unlockNode.press('ArrowLeft')
    await expect(deviceKeyNode).toBeFocused()
    await expect(panel).toContainText('Browser device key')
    const deviceIdentifier = await page
      .getByTestId('devices-access-device-id')
      .innerText()
    expect(deviceIdentifier).not.toBe('Unknown')
    await expect(deviceKeyNode).toContainText(deviceIdentifier)
    await expect(panel).toContainText('A backup password is different')

    await deviceKeyNode.press('ArrowLeft')
    await expect(vaultsNode).toBeFocused()
    await expect(panel).toContainText('Vaults known to this device key')
    await expect(page.getByTestId('devices-access-vaults')).toContainText(
      'Access verified',
    )
    const vaultIdentifier = panel
      .locator('details')
      .filter({ hasText: 'Vault identifier' })
    await expect(vaultIdentifier.locator('p')).toBeHidden()
    await vaultIdentifier.getByText('Vault identifier', { exact: true }).click()
    await expect(vaultIdentifier.locator('p')).toBeVisible()
    const fullVaultIdentifier = await vaultIdentifier.locator('p').innerText()
    await expect(strengthVaults).not.toContainText(fullVaultIdentifier)
    await expect(strengthVaults).not.toContainText(
      fullVaultIdentifier.replaceAll('-', '').replaceAll('_', '').slice(-8),
    )
    await expect(
      page.getByTestId('devices-access-current-vault'),
    ).toContainText('Emergency recovery')
    const memberDetails = page
      .getByTestId('devices-access-member-details')
      .first()
    await expect(memberDetails.locator('p')).toBeHidden()
    await memberDetails.getByText('Device identifier', { exact: true }).click()
    await expect(memberDetails.locator('p')).toBeVisible()

    await panel.getByRole('button', { name: 'Manage enrolled devices' }).click()
    await expect(
      page.getByTestId('vault-devices-section').locator('button').first(),
    ).toBeFocused()
    await page.getByTestId('vault-devices-access-tab').click()
    await vaultsNode.click()
    await panel.getByRole('button', { name: 'Manage backup passwords' }).click()
    await expect(
      page.getByTestId('vault-unlock-section').locator('button').first(),
    ).toBeFocused()
    await page.getByTestId('vault-devices-access-tab').click()

    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('vault-devices-access-tab')).toBeFocused()
  })

  test('names PIN protection without inventing a credential identifier', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
    })
    await page.goto('/app/')
    await page.getByTestId('login-devices-access').click()
    await page.getByTestId('device-protection-create-new-choice').click()
    await page
      .getByTestId('device-protection-label-input')
      .fill('Unavailable passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('device-protection-error')).toBeVisible()
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()

    const unlockNode = page.getByTestId('devices-access-node-unlock')
    await expect(unlockNode).toBeFocused()
    await expect(unlockNode).toContainText('PIN or passphrase')
    await expect(unlockNode).toContainText('Known only to you')
    await expect(unlockNode).not.toContainText('Unknown')
    await expect(unlockNode).not.toContainText('Named by you')
    await expect(unlockNode).toHaveAccessibleName(/Known only to you/)
    await expect(unlockNode).toHaveAccessibleName(/PIN or passphrase/)
    await expect(unlockNode).not.toHaveAccessibleName(/Named by you/)
  })

  test('does not classify an unnamed passkey as user-named', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.evaluate((unknownTextKind) => {
      if (!('__nookVault' in window)) {
        throw new Error('Vault runtime is not exposed')
      }
      const vault = (
        window as Window & {
          __nookVault: {
            requireManager(): { deviceAccessSnapshotRequest: () => unknown }
          }
        }
      ).__nookVault
      const manager = vault.requireManager()
      const original = manager.deviceAccessSnapshotRequest
      manager.deviceAccessSnapshotRequest = () => {
        const request = original.call(manager) as {
          resolve: () => Promise<object>
        }
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          const snapshot = await resolve()
          return new Proxy(snapshot, {
            get(target, property) {
              if (property === 'passkeyName' || property === 'providerLabel') {
                return {
                  kind: unknownTextKind,
                  free(): void {
                    // Browser fixture values do not own WASM memory.
                  },
                }
              }
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        }
        return request
      }
    }, NookDeviceAccessTextKind.Unknown)

    await page.getByTestId('vault-devices-access-tab').click()
    const unlockNode = page.getByTestId('devices-access-node-unlock')
    await expect(unlockNode).toContainText('Unnamed passkey', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(unlockNode).not.toContainText('Named by you')
    await expect(unlockNode).not.toHaveAccessibleName(/Named by you/)
  })

  test('attributes a companion session to its paired device', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.evaluate((companionProtection) => {
      if (!('__nookVault' in window)) {
        throw new Error('Vault runtime is not exposed')
      }
      const vault = (
        window as Window & {
          __nookVault: {
            requireManager(): { deviceAccessSnapshotRequest: () => unknown }
          }
        }
      ).__nookVault
      const manager = vault.requireManager()
      const original = manager.deviceAccessSnapshotRequest
      manager.deviceAccessSnapshotRequest = () => {
        const request = original.call(manager) as {
          resolve: () => Promise<object>
        }
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          const snapshot = await resolve()
          return new Proxy(snapshot, {
            get(target, property) {
              if (property === 'protection') return companionProtection
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        }
        return request
      }
    }, DeviceAccessProtectionKind.CompanionSession)

    await page.getByTestId('vault-devices-access-tab').click()
    const deviceKeyNode = page.getByTestId('devices-access-node-device-key')
    await expect(deviceKeyNode).toContainText('Paired device identity', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(deviceKeyNode).not.toContainText('My browser')
    await expect(deviceKeyNode).toHaveAccessibleName(/Paired device identity/)
    const unlockNode = page.getByTestId('devices-access-node-unlock')
    await expect(unlockNode).not.toContainText('Named by you')
    await expect(unlockNode).not.toHaveAccessibleName(/Named by you/)
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toContainText('Paired device identity')
  })

  test('keeps known vaults visible after identity recovery reset', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toContainText('Test vault', { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

    // The production reset flow is covered in device-key-protection.spec.ts.
    // Reproduce its persisted identity deletion here without invoking the
    // destructive manager call while that same manager is actively rendering.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('nook_db')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('vault', 'readwrite')
            const store = transaction.objectStore('vault')
            store.delete('device_access_profile')
            store.delete('device_identity_wrapped')
            store.delete('device_id')
            transaction.onerror = () => reject(transaction.error)
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
          }
        }),
    )

    await page.reload()
    await page.getByTestId('login-devices-access').click()
    const preview = page.getByTestId('devices-access-chain-preview')
    await expect(preview).toContainText('Known vaults remain on this browser')
    await expect(
      page.getByTestId('devices-access-preview-vaults'),
    ).toContainText('Test vault')
    await expect(
      page.getByTestId('devices-access-preview-vaults'),
    ).toContainText('Access not yet verified')
    await expect(preview).toContainText('not verified')
    await expect(preview).not.toContainText('opens')
    await expect(preview).not.toContainText('No local vaults yet')
  })

  test('never claims access to a vault this device key has not opened', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    const vaultsNode = page.getByTestId('devices-access-node-vaults')
    await expect(vaultsNode).toHaveAccessibleName(/opens/, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    // Verified access is descriptive metadata written after an unlock succeeds.
    // Removing it leaves the vault registered on this browser with nothing
    // proving this device key ever opened it, which is how a locally cached
    // vault from another identity arrives.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('nook_db')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('vault', 'readwrite')
            const store = transaction.objectStore('vault')
            const profileRequest = store.get('device_access_profile')
            profileRequest.onsuccess = () => {
              const raw = profileRequest.result
              if (typeof raw !== 'string') {
                reject(new Error('Device access profile is missing'))
                return
              }
              const profile = JSON.parse(raw) as { verifiedVaults: unknown[] }
              profile.verifiedVaults = []
              store.put(JSON.stringify(profile), 'device_access_profile')
            }
            transaction.onerror = () => reject(transaction.error)
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
          }
        }),
    )

    // The dashboard reads the snapshot when it mounts, so leave and come back.
    await page.getByTestId('vault-secrets-tab').click()
    await page.getByTestId('vault-devices-access-tab').click()

    const chain = page.getByTestId('devices-access-chain')
    await expect(vaultsNode).toHaveAccessibleName(/None verified yet/)
    await expect(chain).toContainText('not verified')
    await expect(chain).not.toContainText('opens')
    // Sighted and screen-reader readouts have to agree that access is unproven.
    await expect(vaultsNode).toHaveAccessibleName(/not verified/)
    await expect(vaultsNode).not.toHaveAccessibleName(/opens/)

    await vaultsNode.click()
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Vaults known to this device key')
    const vaults = page.getByTestId('devices-access-vaults')
    await expect(vaults).toContainText('Access not yet verified')
    await expect(vaults).not.toContainText('Access verified')
  })

  test('keeps the passkey provider reminder editable and recovers from a failed save', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page
      .getByTestId('devices-access-provider-label')
      .fill('Bitwarden family vault')
    await page.getByTestId('devices-access-provider-save').click()
    await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
      'Bitwarden family vault',
    )
    await expect(
      page.getByTestId('devices-access-node-unlock'),
    ).toHaveAccessibleName(/Bitwarden family vault/)
    await expect(
      page.getByTestId('devices-access-provider-label'),
    ).toBeFocused()
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).not.toContainText('Bitwarden family vault')

    await page.getByTestId('devices-access-node-unlock').click()
    await page
      .getByTestId('devices-access-provider-label')
      .fill('Proton Pass family vault')
    // The reminder is written before the dashboard re-reads its snapshot, so
    // failing the next snapshot read exercises "saved, but reload failed".
    await page.evaluate(() => {
      const manager = (
        window as Window & {
          __nookVault?: {
            requireManager(): { deviceAccessSnapshotRequest: () => unknown }
          }
        }
      ).__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      const original = manager.deviceAccessSnapshotRequest
      manager.deviceAccessSnapshotRequest = () => {
        manager.deviceAccessSnapshotRequest = original
        throw new Error('Forced dashboard reload failure')
      }
    })
    await page.getByTestId('devices-access-provider-save').click()
    await expect(page.getByTestId('devices-access-retry')).toBeFocused()
    await page.getByTestId('devices-access-retry').click()
    await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
      'Proton Pass family vault',
    )

    // Selecting another link while the save is re-reading the snapshot unmounts
    // the input the save would have refocused, so focus has to follow the link.
    await page.evaluate(() => {
      const scope = window as Window & {
        __nookVault?: {
          requireManager(): { deviceAccessSnapshotRequest: () => unknown }
        }
        __nookReloadSettled?: boolean
      }
      const manager = scope.__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      scope.__nookReloadSettled = false
      const original = manager.deviceAccessSnapshotRequest
      manager.deviceAccessSnapshotRequest = () => {
        manager.deviceAccessSnapshotRequest = original
        const request = original.call(manager) as {
          resolve: () => Promise<unknown>
        }
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          await new Promise((settle) => setTimeout(settle, 750))
          const snapshot = await resolve()
          scope.__nookReloadSettled = true
          return snapshot
        }
        return request
      }
    })
    await page.getByTestId('devices-access-provider-label').fill('1Password')
    await page.getByTestId('devices-access-provider-save').click()
    await page.getByTestId('devices-access-node-vaults').click()
    await page.waitForFunction(
      () =>
        (window as Window & { __nookReloadSettled?: boolean })
          .__nookReloadSettled === true,
    )
    await expect(page.getByTestId('devices-access-node-vaults')).toBeFocused()
  })

  test('a locked browser identity keeps last-known vault access without vault contents', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page.getByTestId('header-lock-vault-btn').click()
    await page.getByTestId('login-devices-access').click()
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity locked')
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(page.getByTestId('devices-access-vaults')).toContainText(
      'Access verified',
    )
    await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(
      0,
    )
  })
})
