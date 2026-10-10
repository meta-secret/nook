import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import { Effect } from 'effect'
import SecretVault from '$lib/components/SecretVault.svelte'
import { NookSecretTypeFilter, secret_type_name } from '$app-wasm'
import { SecretType } from '$lib/nook'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import type { SecretPageRefreshSnapshot } from '$lib/vault/action-contexts'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

/** Supplies Rust-owned list projections without implementing search or filtering. */
class PasskeyVaultDiscoveryFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly passkey = SecretComponentTestFixture.listItem(this.passkeyFields())
  readonly login = SecretComponentTestFixture.listItem(this.loginFields())
  readonly loadPage = vi.spyOn(this.vault, 'loadSecretPage')
  readonly decrypt = vi.spyOn(this.vault, 'decryptSecret')

  private passkeyFields(): Parameters<
    typeof SecretComponentTestFixture.listItem
  >[0] {
    return {
      id: 'secret_website_passkey',
      type: SecretType.Passkey,
      typeName: 'passkey',
      rpId: 'login.example.com',
      groupKey: 'login.example.com',
      displayTitle: 'login.example.com',
      summary: 'alice@example.com',
      passkeyUserName: 'alice@example.com',
      passkeyUserDisplayName: 'Alice',
    }
  }

  private loginFields(): Parameters<
    typeof SecretComponentTestFixture.listItem
  >[0] {
    return {
      id: 'secret_login',
      type: SecretType.Login,
      groupKey: 'other.example.com',
      displayTitle: 'Other login',
      username: 'bob@example.com',
    }
  }

  constructor() {
    this.vault.secrets = [this.passkey, this.login]
    this.vault.secretTotal = 2
    vi.spyOn(this.vault, 't').mockImplementation((request) => {
      switch (typeof request) {
        case 'string':
          return request
        case 'object':
          return request.key
        case 'number':
        case 'bigint':
        case 'boolean':
        case 'symbol':
        case 'undefined':
        case 'function':
          throw new Error('unsupported translation request')
      }
    })
    this.loadPage.mockImplementation((request) => {
      this.vault.secretQuery = request.query
      this.vault.secretPageOffset = request.requestedOffset
      this.vault.secretPageRequestOffset = request.requestedOffset
      const snapshot: SecretPageRefreshSnapshot = {
        displayedSecretCount: 1,
        totalSecretCount: 1,
        pageOffset: request.requestedOffset,
        query: request.query,
      }
      return Effect.runPromise(Effect.succeed(ok(snapshot)))
    })
  }

  props(): ComponentProps<typeof SecretVault> {
    return {
      vault: this.vault,
      secrets: this.vault.secrets,
      isSaving: false,
      onAddSecret: vi.fn().mockResolvedValue(ok(SecretMutationOutcome.Added)),
      onReplaceSecret: vi
        .fn()
        .mockResolvedValue(ok(SecretMutationOutcome.Replaced)),
      onDeleteSecret: vi
        .fn()
        .mockResolvedValue(ok(SecretMutationOutcome.Deleted)),
      onGeneratePassword: vi.fn().mockReturnValue('generated-password'),
    }
  }

  receivePasskeyPage(): ComponentProps<typeof SecretVault> {
    this.vault.secrets = [this.passkey]
    this.vault.secretTotal = 1
    return this.props()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  try {
    cleanup()
    await tick()
    await vi.runOnlyPendingTimersAsync()
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

test('discovers a website passkey in the complete vault and expands safe account metadata', async () => {
  const fixture = new PasskeyVaultDiscoveryFixture()
  const props = fixture.props()
  const view = render(SecretVault, props)
  const passkeyGroup = view.getByTestId('vault-group-passkey')
  expect(view.getAllByTestId('vault-site-group')).toHaveLength(2)
  expect(view.getByText('login.example.com')).toBeTruthy()
  expect(passkeyGroup.textContent).toContain('Alice')
  await fireEvent.click(within(passkeyGroup).getByTestId('secret-row-toggle'))
  expect(passkeyGroup.textContent).toContain('alice@example.com')
  expect(
    passkeyGroup.querySelectorAll('[data-testid="reveal-secret-btn"]'),
  ).toHaveLength(0)
  expect(
    passkeyGroup.querySelectorAll('[data-testid="edit-secret-btn"]'),
  ).toHaveLength(0)
  expect(
    passkeyGroup.querySelectorAll('[data-testid="delete-secret-btn"]'),
  ).toHaveLength(1)
  expect(fixture.decrypt).not.toHaveBeenCalled()
})

test('requests the Passkey filter and displays the returned passkey page', async () => {
  const fixture = new PasskeyVaultDiscoveryFixture()
  const props = fixture.props()
  const view = render(SecretVault, props)
  const openFilter: Parameters<typeof fireEvent.keyDown>[1] = { key: 'Enter' }
  await fireEvent.keyDown(view.getByTestId('secret-type-filter'), openFilter)
  const chooseFilter: Parameters<typeof fireEvent.pointerUp>[1] = {
    pointerType: 'mouse',
  }
  await fireEvent.pointerUp(
    view.getByTestId(
      `secret-type-filter-${secret_type_name(SecretType.Passkey)}`,
    ),
    chooseFilter,
  )
  expect(fixture.vault.secretTypeFilter).toBe(NookSecretTypeFilter.Passkey)
  const request: Parameters<typeof fixture.vault.loadSecretPage>[0] = {
    query: '',
    requestedOffset: 0,
  }
  expect(fixture.loadPage).toHaveBeenCalledWith(request)
  const received = fixture.receivePasskeyPage()
  await view.rerender(received)
  expect(view.getAllByTestId('vault-site-group')).toHaveLength(1)
  expect(view.getByTestId('vault-site-group').textContent).toContain('Alice')
  expect(view.getByTestId('secret-type-filter').textContent).toContain(
    I18N_KEYS.VaultTypesPasskey,
  )
})

test('searches RP or account through the vault page contract and keeps passkey metadata visible', async () => {
  const fixture = new PasskeyVaultDiscoveryFixture()
  const props = fixture.props()
  const view = render(SecretVault, props)
  const searchEvent: Parameters<typeof fireEvent.input>[1] = {
    target: { value: 'alice@example.com' },
  }
  await fireEvent.input(view.getByTestId('search-secrets'), searchEvent)
  await vi.advanceTimersByTimeAsync(200)
  const request: Parameters<typeof fixture.vault.loadSecretPage>[0] = {
    query: 'alice@example.com',
    requestedOffset: 0,
  }
  expect(fixture.loadPage).toHaveBeenCalledWith(request)
  const received = fixture.receivePasskeyPage()
  await view.rerender(received)
  await tick()
  expect(view.getByTestId('vault-site-group').textContent).toContain(
    'login.example.com',
  )
  expect(view.getByTestId('vault-site-group').textContent).toContain('Alice')
  expect(fixture.decrypt).not.toHaveBeenCalled()
})
