import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import { expect as baseExpect, test } from './fixtures'
import { createWorkspace } from './helpers/workspace'

const expect = baseExpect.configure({ timeout: 30000 })
test.use({ actionTimeout: 30000 })

test('exposes only the project capability and Rust rejects the opposite vault type', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem('nook_e2e_manual_passkey', 'true'),
  )
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Create new passkey', exact: true })
    .click()
  const isSimple = testInfo.project.name === 'simple-isolation'
  const expectedKind = isSimple ? 'simple' : 'sentinel'
  await expect(page.locator('meta[name="nook-app-kind"]')).toHaveAttribute(
    'content',
    expectedKind,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __nookConfiguredVaultApplication?: string })
            .__nookConfiguredVaultApplication,
      ),
    )
    .toBe(expectedKind)
  await expect(page.getByLabel('Vault name', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create a vault', exact: true }),
  ).toHaveCount(isSimple ? 1 : 0)
  const error = await page.evaluate((simpleApp) => {
    const vault = window.__nookVault
    if (!vault) return 'Vault debug hooks are unavailable'
    const admission = vault.admitManager()
    if (admission.isErr()) return admission.error.translationKey
    const manager = admission.value
    const current = manager.vaultArchitecture
    const Architecture = window.__nookVaultArchitecture
    if (!Architecture) {
      current.free()
      return 'Vault architecture factory is unavailable'
    }
    const sentinelFactory = Architecture.sentinel
    const simpleFactory = Architecture.simple
    const oppositeArchitecture = simpleApp
      ? sentinelFactory(current.device_mode, current.replication_type, 2, 3, 0)
      : simpleFactory(current.device_mode, current.replication_type)
    try {
      manager.set_vault_architecture(oppositeArchitecture)
      return ''
    } catch (caught) {
      return caught instanceof Error ? caught.message : String(caught)
    } finally {
      oppositeArchitecture.free()
      current.free()
    }
  }, isSimple)
  expect(error).toContain(
    I18N_KEYS.ErrorsValidationVaultApplicationTypeMismatch,
  )
})

test('rejects extension routing on Sentinel and isolates local vault storage by origin', async ({
  page,
  context,
}, testInfo) => {
  const isSimple = testInfo.project.name === 'simple-isolation'
  const response = await page.request.get('/extension-connect')
  expect(response.status()).toBe(isSimple ? 200 : 404)
  if (!isSimple) return
  await createWorkspace(page, 'Origin-local vault', '/')
  const sentinel = await context.newPage()
  await sentinel.goto('http://127.0.0.1:5175/')
  await expect(
    sentinel.getByRole('heading', { name: 'A quiet place for your secrets.' }),
  ).toBeVisible()
  await expect(
    sentinel.getByRole('button').filter({ hasText: 'Origin-local vault' }),
  ).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'All items' })).toBeVisible()
})

test('Sentinel creates protected participant shares and requires a quorum to unlock', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'sentinel-isolation',
    'Sentinel capability only',
  )
  const { installMockPasskeyRuntime } = await import('./passkey-mock')
  const participantContext = await browser.newContext()
  await participantContext.addInitScript(installMockPasskeyRuntime)
  await participantContext.addInitScript(() =>
    localStorage.setItem('nook_e2e_manual_passkey', 'true'),
  )
  const participant = await participantContext.newPage()
  try {
    await page.addInitScript(() =>
      localStorage.setItem('nook_e2e_manual_passkey', 'true'),
    )
    for (const device of [page, participant]) {
      await device.goto('http://127.0.0.1:5175/')
      await device
        .getByRole('button', { name: 'Create new passkey', exact: true })
        .click()
      await expect(
        device.getByLabel('Vault name', { exact: true }),
      ).toBeVisible()
    }
    await page.getByLabel('Vault name', { exact: true }).fill('Quorum vault')
    await page
      .getByRole('button', { name: 'Start Sentinel setup', exact: true })
      .click()
    const invitation = await page
      .getByLabel('Participant request', { exact: true })
      .inputValue()
    const join = participant.locator('details').filter({
      has: participant.getByText('Sentinel invitation', { exact: true }),
    })
    await join.locator('summary').click()
    await join.getByLabel('Owner invitation', { exact: true }).fill(invitation)
    await join
      .getByRole('button', { name: 'Create response', exact: true })
      .click()
    const response = await join
      .getByLabel('Authentication response', { exact: true })
      .inputValue()
    await page
      .getByLabel('Authentication response', { exact: true })
      .fill(response)
    await page.getByLabel('Participant', { exact: true }).fill('Second device')
    await page
      .getByRole('button', { name: 'Verify participant', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Create Sentinel vault', exact: true })
      .click()
    const delivery = page.locator('textarea[readonly]').last()
    await expect(delivery).not.toHaveValue(invitation)
    const share = await delivery.inputValue()
    await join
      .getByLabel('Encrypted share from initiator', { exact: true })
      .fill(share)
    await join
      .getByRole('button', { name: "Protect this device's share", exact: true })
      .click()
    await expect(participant.getByRole('status')).toContainText(
      'protected locally',
    )
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page
      .getByRole('button', { name: 'Start quorum unlock', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Open vault', exact: true }),
    ).toBeDisabled()
    const request = await page
      .getByLabel('Unlock request', { exact: true })
      .inputValue()
    const help = participant.locator('details').filter({
      has: participant.getByText('Help another device unlock', {
        exact: true,
      }),
    })
    await help.locator('summary').click()
    await expect(
      help.getByLabel('Protected Sentinel share').locator('option'),
    ).toHaveCount(2)
    await help.getByLabel('Protected Sentinel share').selectOption({ index: 1 })
    await help.getByLabel('Request from the other device').fill(request)
    await help
      .getByRole('button', { name: 'Create response', exact: true })
      .click()
    const unlockResponse = await help
      .getByLabel('One-time response')
      .inputValue()
    await page
      .getByLabel('Participant response', { exact: true })
      .fill(unlockResponse)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Open vault', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All items' })).toBeVisible()
  } finally {
    await participantContext.close()
  }
})
