import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import { Effect } from 'effect'
import SecretVault from '$lib/components/SecretVault.svelte'
import { NookSecretTypeFilter, secret_type_name } from '$app-wasm'
import {
  PasskeyNameKind,
  SecretOriginDeviceKind,
  SecretRevisionKind,
  SecretType,
  type PasskeyDetailsView,
  type SecretHistoryView,
} from '$lib/nook'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import type { SecretPageRefreshSnapshot } from '$lib/vault/action-contexts'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture } from './secret-component-test-fixture'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'

/** Supplies Rust-owned list projections without implementing search or filtering. */
class PasskeyVaultDiscoveryFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly passkey = SecretComponentTestFixture.listItem(this.passkeyFields())
  readonly login = SecretComponentTestFixture.listItem(this.loginFields())
  readonly loadPage = vi.spyOn(this.vault, 'loadSecretPage')
  readonly decrypt = vi.spyOn(this.vault, 'decryptSecret')
  readonly passkeyDetails = vi.spyOn(this.vault, 'passkeyDetails')
  readonly secretHistory = vi.spyOn(this.vault, 'secretHistory')
  readonly history: SecretHistoryView = {
    originLabelKey: I18N_KEYS.VaultFieldsHistoryCreated,
    originAt: '2026-01-02T03:04:05Z',
    originDevice: {
      kind: SecretOriginDeviceKind.Recorded,
      device: { labelKey: I18N_KEYS.VaultFieldsHistoryDeviceThis, value: '' },
    },
    revision: {
      kind: SecretRevisionKind.Revised,
      at: '2026-03-01T00:00:00Z',
      device: {
        labelKey: I18N_KEYS.VaultFieldsHistoryDeviceNamed,
        value: 'Work laptop',
      },
    },
  }
  readonly details: PasskeyDetailsView = {
    credentialId: 'Y3JlZGVudGlhbC1pZC1maXh0dXJl',
    relyingPartyName: { kind: PasskeyNameKind.Distinct, text: 'Example Login' },
    userName: { kind: PasskeyNameKind.Distinct, text: 'alice@example.com' },
    algorithmLabelKey: I18N_KEYS.VaultFieldsPasskeyAlgorithmEs256,
    publicKeyFingerprint: 'SHA256:9+DIAhGaEvPhUkquTXtzDLd10GrycDMuT91vONRZCiY',
    signatureCount: 7,
    discoverableLabelKey: I18N_KEYS.VaultFieldsPasskeyDiscoverableYes,
    backupStatusLabelKey: I18N_KEYS.VaultFieldsPasskeyBackupBackedUp,
  }

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
    this.passkeyDetails.mockResolvedValue(ok(this.details))
    this.secretHistory.mockResolvedValue(ok(this.history))
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
  await tick()
  await tick()
  expect(fixture.passkeyDetails).toHaveBeenCalledWith('secret_website_passkey')
  expect(fixture.secretHistory).toHaveBeenCalledWith('secret_website_passkey')
  expect(
    within(passkeyGroup).getByTestId('history-origin').textContent,
  ).toContain(I18N_KEYS.VaultFieldsHistoryCreated)
  expect(
    within(passkeyGroup)
      .getByTestId('history-modified')
      .querySelector('time')
      ?.getAttribute('datetime'),
  ).toBe('2026-03-01T00:00:00Z')
  expect(passkeyGroup.textContent).toContain('alice@example.com')
  expect(
    within(passkeyGroup).getByTestId('passkey-credential-id').textContent,
  ).toContain(fixture.details.credentialId)
  expect(
    within(passkeyGroup).getByTestId('passkey-public-key-fingerprint')
      .textContent,
  ).toContain(fixture.details.publicKeyFingerprint)
  expect(
    within(passkeyGroup).getByTestId('passkey-signature-count').textContent,
  ).toContain('7')
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

test('shows an explicit error when passkey details cannot be read', async () => {
  const fixture = new PasskeyVaultDiscoveryFixture()
  fixture.passkeyDetails.mockResolvedValue(
    err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
  )
  const view = render(SecretVault, fixture.props())
  const passkeyGroup = view.getByTestId('vault-group-passkey')
  await fireEvent.click(within(passkeyGroup).getByTestId('secret-row-toggle'))
  await tick()
  await tick()
  expect(
    within(passkeyGroup).getByTestId('passkey-details-error').textContent,
  ).toContain(I18N_KEYS.VaultFieldsPasskeyDetailsUnavailable)
  expect(
    passkeyGroup.querySelectorAll('[data-testid="passkey-credential-id"]'),
  ).toHaveLength(0)
})

test('treats an unreadable event time as a failed history, not raw text', async () => {
  const fixture = new PasskeyVaultDiscoveryFixture()
  fixture.secretHistory.mockResolvedValue(
    ok({
      ...fixture.history,
      revision: {
        kind: SecretRevisionKind.Revised,
        at: '2026-13-45T99',
        device: {
          labelKey: I18N_KEYS.VaultFieldsHistoryDeviceNamed,
          value: 'Work laptop',
        },
      },
    }),
  )
  const view = render(SecretVault, fixture.props())
  const passkeyGroup = view.getByTestId('vault-group-passkey')
  await fireEvent.click(within(passkeyGroup).getByTestId('secret-row-toggle'))
  await tick()
  await tick()
  expect(
    within(passkeyGroup).getByTestId('history-error').textContent,
  ).toContain(I18N_KEYS.VaultFieldsHistoryUnavailable)
  expect(passkeyGroup.textContent).not.toContain('2026-13-45T99')
  expect(
    passkeyGroup.querySelectorAll('[data-testid="history-origin"]'),
  ).toHaveLength(0)
})

test('requests the Passkey filter and displays the returned passkey page', async () => {
  const fixture = new PasskeyVaultDiscoveryFixture()
  const props = fixture.props()
  const view = render(SecretVault, props)
  await fireEvent.click(
    view.getByTestId(
      `secret-type-filter-${secret_type_name(SecretType.Passkey)}`,
    ),
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
  expect(
    view
      .getByTestId(`secret-type-filter-${secret_type_name(SecretType.Passkey)}`)
      .getAttribute('aria-pressed'),
  ).toBe('true')
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
