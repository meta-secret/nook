import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import SecretVault from '$lib/components/SecretVault.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { SecretType, type NookSecretRecord } from '$lib/nook'
import { secret_type_name } from '$app-wasm'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import type { SecretPageRefreshSnapshot } from '$lib/vault/action-contexts'
import {
  VaultOperationStale,
  VaultOperationStaleKind,
} from '$lib/runtime/vault-operation-stale'
import { SecretComponentTestFixture } from './secret-component-test-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

type SecretPageResult = Awaited<ReturnType<VaultState['loadSecretPage']>>
type SecretDecryptionResult = Awaited<ReturnType<VaultState['decryptSecret']>>

enum SecretOperationResolverKind {
  Waiting = 'waiting',
  Available = 'available',
}

type SecretOperationResolver<Value> =
  | { readonly kind: SecretOperationResolverKind.Waiting }
  | {
      readonly kind: SecretOperationResolverKind.Available
      readonly resolve: (value: Value) => void
    }

type DeferredSecretOperation<Value> = {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
}

/** Controls the existing browser search/decrypt boundaries without replacing exposure ownership. */
class SecretVaultSearchFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly search = this.deferred<SecretPageResult>()
  readonly filterPage = this.deferred<SecretPageResult>()
  readonly decryption = this.deferred<SecretDecryptionResult>()
  readonly record: NookSecretRecord
  readonly loadPage = vi.spyOn(this.vault, 'loadSecretPage')
  readonly decrypt = vi.spyOn(this.vault, 'decryptSecret')

  private deferred<Value>(): DeferredSecretOperation<Value> {
    let resolver: SecretOperationResolver<Value> = {
      kind: SecretOperationResolverKind.Waiting,
    }
    const promise = new Promise<Value>((resolve) => {
      const available: SecretOperationResolver<Value> = {
        kind: SecretOperationResolverKind.Available,
        resolve,
      }
      resolver = available
    })
    const operation: DeferredSecretOperation<Value> = {
      promise,
      resolve: (value) => {
        switch (resolver.kind) {
          case SecretOperationResolverKind.Waiting:
            throw new Error('Secret operation resolver was not initialized')
          case SecretOperationResolverKind.Available:
            resolver.resolve(value)
        }
      },
    }
    return operation
  }

  constructor() {
    const recordFields: Parameters<
      typeof SecretComponentTestFixture.record
    >[0] = {
      primaryCredential: 'revealed-password',
      password: 'revealed-password',
      notes: 'revealed-note',
    }
    this.record = SecretComponentTestFixture.record(recordFields)
    const itemFields: Parameters<
      typeof SecretComponentTestFixture.listItem
    >[0] = {
      id: 'secret-fixture',
      username: 'demand-user-54',
      websiteHost: 'demand.example',
      websiteUrl: 'https://demand.example',
      groupKey: 'demand.example',
    }
    this.vault.secrets = [SecretComponentTestFixture.listItem(itemFields)]
    this.vault.secretPageOffset = 50
    this.vault.secretPageRequestOffset = 50
    this.vault.secretTotal = 55
    vi.spyOn(this.vault, 't').mockImplementation((request) => {
      switch (typeof request) {
        case 'string':
          return request
        default:
          return request.key
      }
    })
    this.loadPage.mockImplementation((request) => {
      this.vault.secretQuery = request.query
      this.vault.secretPageRequestOffset = request.requestedOffset
      ++this.vault.secretPageGeneration
      switch (this.loadPage.mock.calls.length) {
        case 1:
          return this.search.promise
        default:
          return this.filterPage.promise
      }
    })
    this.decrypt.mockReturnValue(this.decryption.promise)
  }

  render() {
    const props: ComponentProps<typeof SecretVault> = {
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
    return render(SecretVault, props)
  }

  finishSearch(): void {
    this.vault.secretPageOffset = 0
    this.vault.secretPageRequestOffset = 0
    this.vault.secretTotal = 1
    const snapshot: SecretPageRefreshSnapshot = {
      displayedSecretCount: 1,
      totalSecretCount: 1,
      pageOffset: 0,
      query: this.vault.secretQuery,
    }
    this.search.resolve(ok(snapshot))
  }

  finishStaleSearch(): void {
    const staleKind: ConstructorParameters<typeof VaultOperationStale>[0] =
      VaultOperationStaleKind.RequestSuperseded
    const stale = new VaultOperationStale(staleKind)
    this.search.resolve(ok(stale))
  }

  finishFilter(): void {
    this.vault.secretPageOffset = 0
    this.vault.secretPageRequestOffset = 0
    const snapshot: SecretPageRefreshSnapshot = {
      displayedSecretCount: 1,
      totalSecretCount: 1,
      pageOffset: 0,
      query: this.vault.secretQuery,
    }
    this.filterPage.resolve(ok(snapshot))
  }

  finishDecryption(): void {
    this.decryption.resolve(ok(this.record))
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('waits for the filtered page before revealing and frees the record when hidden', async () => {
  vi.useFakeTimers()
  const fixture = new SecretVaultSearchFixture()
  const view = fixture.render()
  await tick()
  const inputEvent: Parameters<typeof fireEvent.input>[1] = {
    target: { value: 'demand-user-54' },
  }
  await fireEvent.input(view.getByTestId('search-secrets'), inputEvent)
  const reveal = view.getByTestId('reveal-secret-btn')
  expect(reveal.hasAttribute('disabled')).toBe(true)
  expect(fixture.decrypt).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200)
  expect(fixture.loadPage).toHaveBeenCalledTimes(1)
  expect(reveal.hasAttribute('disabled')).toBe(true)
  fixture.finishSearch()
  await tick()
  await tick()
  expect(reveal.hasAttribute('disabled')).toBe(false)
  await fireEvent.click(view.getByTestId('secret-row-toggle'))
  await fireEvent.click(reveal)
  expect(fixture.decrypt).toHaveBeenCalledTimes(1)
  expect(view.getByTestId('revealed-secret').textContent).toContain('••••')
  fixture.finishDecryption()
  await tick()
  await tick()
  expect(view.getByTestId('revealed-secret').textContent).toContain(
    'revealed-password',
  )
  expect(view.getByText('revealed-note')).toBeTruthy()
  await fireEvent.click(reveal)
  expect(view.getByTestId('revealed-secret').textContent).toContain('••••')
  expect(view.queryByText('revealed-note')).toBeFalsy()
  expect(fixture.record.free).toHaveBeenCalledTimes(1)
})

test('frees an in-flight reveal when the search changes and never renders the stale plaintext', async () => {
  vi.useFakeTimers()
  const fixture = new SecretVaultSearchFixture()
  const view = fixture.render()
  await tick()
  await fireEvent.click(view.getByTestId('secret-row-toggle'))
  await fireEvent.click(view.getByTestId('reveal-secret-btn'))
  expect(fixture.decrypt).toHaveBeenCalledTimes(1)
  const inputEvent: Parameters<typeof fireEvent.input>[1] = {
    target: { value: 'another-query' },
  }
  await fireEvent.input(view.getByTestId('search-secrets'), inputEvent)
  await vi.advanceTimersByTimeAsync(200)
  fixture.finishDecryption()
  await tick()
  await tick()
  expect(view.getByTestId('revealed-secret').textContent).toContain('••••')
  expect(fixture.record.free).toHaveBeenCalledTimes(1)
  expect(view.queryByText('revealed-password')).toBeFalsy()
})

test('keeps reveal disabled when a pending filter supersedes the search page', async () => {
  vi.useFakeTimers()
  const fixture = new SecretVaultSearchFixture()
  const view = fixture.render()
  await tick()
  const inputEvent: Parameters<typeof fireEvent.input>[1] = {
    target: { value: 'demand-user-54' },
  }
  await fireEvent.input(view.getByTestId('search-secrets'), inputEvent)
  await vi.advanceTimersByTimeAsync(200)
  expect(fixture.loadPage).toHaveBeenCalledTimes(1)
  const openFilterEvent: Parameters<typeof fireEvent.keyDown>[1] = {
    key: 'Enter',
  }
  await fireEvent.keyDown(
    view.getByTestId('secret-type-filter'),
    openFilterEvent,
  )
  expect(
    view.getByTestId('secret-type-filter').getAttribute('aria-expanded'),
  ).toBe('true')
  const loginType: Parameters<typeof secret_type_name>[0] = SecretType.Login
  const selectFilterEvent: Parameters<typeof fireEvent.pointerUp>[1] = {
    pointerType: 'mouse',
  }
  await fireEvent.pointerUp(
    view.getByTestId(`secret-type-filter-${secret_type_name(loginType)}`),
    selectFilterEvent,
  )
  expect(fixture.loadPage).toHaveBeenCalledTimes(2)
  const reveal = view.getByTestId('reveal-secret-btn')
  fixture.finishStaleSearch()
  await tick()
  await tick()
  expect(reveal.hasAttribute('disabled')).toBe(true)
  expect(fixture.decrypt).not.toHaveBeenCalled()
  fixture.finishFilter()
  await tick()
  await tick()
  expect(reveal.hasAttribute('disabled')).toBe(false)
  await fireEvent.click(reveal)
  expect(fixture.decrypt).toHaveBeenCalledTimes(1)
})
