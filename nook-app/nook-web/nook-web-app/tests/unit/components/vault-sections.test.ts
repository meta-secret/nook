import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import {
  NookSecretTypeFilter,
  SecretCategory,
  secret_type_category,
  secret_type_name,
} from '$app-wasm'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'
import SecretVault from '$lib/components/SecretVault.svelte'
import { SecretType } from '$lib/nook'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import type { SecretPageRefreshSnapshot } from '$lib/vault/action-contexts'
import { VaultSections } from '$lib/vault/secret-sections'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

const SECRETS_TYPES = [
  SecretType.Login,
  SecretType.Authenticator,
  SecretType.ApiKey,
  SecretType.SeedPhrase,
  SecretType.SecureNote,
  SecretType.FileAttachment,
  SecretType.Passkey,
]
const PERSONAL_TYPES = [
  SecretType.Person,
  SecretType.Address,
  SecretType.IdentityDocument,
  SecretType.BankAccount,
  SecretType.CreditCard,
]

/** Renders the vault page against the real vault state and a recorded page loader. */
class VaultSectionsFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly loadPage = vi.spyOn(this.vault, 'loadSecretPage')

  constructor() {
    this.vault.secrets = [
      SecretComponentTestFixture.listItem({
        id: 'secret_login',
        type: SecretType.Login,
        groupKey: 'example.com',
        username: 'alice',
      }),
    ]
    this.vault.secretTotal = 1
    vi.spyOn(this.vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    this.loadPage.mockImplementation(async (request) => {
      const snapshot: SecretPageRefreshSnapshot = {
        displayedSecretCount: 0,
        totalSecretCount: 0,
        pageOffset: request.requestedOffset,
        query: request.query,
      }
      return ok(snapshot)
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
}

function filterTestIds(container: HTMLElement): (string | undefined)[] {
  return within(container)
    .getAllByRole('button')
    .map((button) => button.dataset.testid)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('vault section definitions', () => {
  test('list each type in the section Rust assigns it to', () => {
    for (const section of VaultSections.order) {
      for (const entry of VaultSections.definition(section).types) {
        expect(secret_type_category(entry.type)).toBe(section)
      }
    }
  })

  test('cover every secret type exactly once across both sections', () => {
    const listed = VaultSections.order.flatMap((section) =>
      VaultSections.definition(section).types.map((entry) => entry.type),
    )
    expect([...listed].sort()).toEqual(
      [...SECRETS_TYPES, ...PERSONAL_TYPES].sort(),
    )
  })

  test('use the Rust section filters for "All"', () => {
    expect(VaultSections.allFilter(SecretCategory.Secrets)).toBe(
      NookSecretTypeFilter.Secrets,
    )
    expect(VaultSections.allFilter(SecretCategory.PersonalData)).toBe(
      NookSecretTypeFilter.PersonalData,
    )
  })
})

describe('vault section switch', () => {
  test('opens on Secrets with only the secret type filters', () => {
    const fixture = new VaultSectionsFixture()
    const view = render(SecretVault, fixture.props())

    expect(fixture.vault.secretSection).toBe(SecretCategory.Secrets)
    expect(fixture.vault.secretTypeFilter).toBe(NookSecretTypeFilter.Secrets)
    expect(
      view.getByTestId('vault-section-secrets').getAttribute('aria-selected'),
    ).toBe('true')
    expect(filterTestIds(view.getByTestId('secret-type-filter'))).toEqual([
      'secret-type-filter-all',
      ...SECRETS_TYPES.map(
        (type) => `secret-type-filter-${secret_type_name(type)}`,
      ),
    ])
    expect(
      view.getByTestId('secret-type-filter-all').getAttribute('aria-pressed'),
    ).toBe('true')
  })

  test('switches to Personal data, its filters and its Rust section filter', async () => {
    const fixture = new VaultSectionsFixture()
    const view = render(SecretVault, fixture.props())

    await fireEvent.click(view.getByTestId('vault-section-personal-data'))

    expect(fixture.vault.secretSection).toBe(SecretCategory.PersonalData)
    expect(fixture.vault.secretTypeFilter).toBe(
      NookSecretTypeFilter.PersonalData,
    )
    const firstPage: Parameters<typeof fixture.vault.loadSecretPage>[0] = {
      query: '',
      requestedOffset: 0,
    }
    expect(fixture.loadPage).toHaveBeenCalledWith(firstPage)
    expect(
      view
        .getByTestId('vault-section-personal-data')
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(filterTestIds(view.getByTestId('secret-type-filter'))).toEqual([
      'secret-type-filter-all',
      ...PERSONAL_TYPES.map(
        (type) => `secret-type-filter-${secret_type_name(type)}`,
      ),
    ])

    await fireEvent.click(
      view.getByTestId(
        `secret-type-filter-${secret_type_name(SecretType.BankAccount)}`,
      ),
    )
    expect(fixture.vault.secretTypeFilter).toBe(
      NookSecretTypeFilter.BankAccount,
    )

    await fireEvent.click(view.getByTestId('secret-type-filter-all'))
    expect(fixture.vault.secretTypeFilter).toBe(
      NookSecretTypeFilter.PersonalData,
    )

    await fireEvent.click(view.getByTestId('vault-section-secrets'))
    expect(fixture.vault.secretSection).toBe(SecretCategory.Secrets)
    expect(fixture.vault.secretTypeFilter).toBe(NookSecretTypeFilter.Secrets)
  })

  test('offers only the open section types in the add picker', async () => {
    const fixture = new VaultSectionsFixture()
    const view = render(SecretVault, fixture.props())

    await fireEvent.click(view.getByTestId('vault-section-personal-data'))
    await fireEvent.click(view.getByTestId('add-secret-btn'))
    await tick()

    expect(filterTestIds(view.getByTestId('item-type-picker'))).toEqual(
      PERSONAL_TYPES.map((type) => `item-type-${secret_type_name(type)}`),
    )
  })

  test('returns to Secrets when the session clears the type filter', async () => {
    const fixture = new VaultSectionsFixture()
    fixture.vault.selectSecretSection(SecretCategory.PersonalData)

    fixture.vault.clearSecretTypeFilter()

    expect(fixture.vault.secretSection).toBe(SecretCategory.Secrets)
    expect(fixture.vault.secretTypeFilter).toBe(NookSecretTypeFilter.Secrets)
  })
})

describe('add picker by section', () => {
  const vault = VaultStateTestFixture.create()

  function renderPicker(section: SecretCategory) {
    vi.spyOn(vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    return render(AddSecretForm, {
      vault,
      isSaving: false,
      section,
      onAddSecret: vi.fn(async () =>
        ok<SecretMutationOutcome.Added, never>(SecretMutationOutcome.Added),
      ),
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
    })
  }

  test('lists the secret types for Secrets', () => {
    const view = renderPicker(SecretCategory.Secrets)
    expect(filterTestIds(view.getByTestId('item-type-picker'))).toEqual(
      SECRETS_TYPES.map((type) => `item-type-${secret_type_name(type)}`),
    )
  })

  test('lists person, address, document, bank account and card for Personal data', () => {
    const view = renderPicker(SecretCategory.PersonalData)
    expect(filterTestIds(view.getByTestId('item-type-picker'))).toEqual(
      PERSONAL_TYPES.map((type) => `item-type-${secret_type_name(type)}`),
    )
  })
})
