import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { ok } from 'neverthrow'
import type { PersonalDataView } from '$app-wasm'
import SecretDetail from '$lib/components/vault/SecretDetail.svelte'
import {
  SecretPageInteractionKind,
  SecretRevealKind,
  type SecretReveal,
} from '$lib/components/secret-vault-state'
import { SecretType, type NookSecretListItem } from '$lib/nook'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

const vault = VaultStateTestFixture.create()

type DetailRender = {
  readonly item: NookSecretListItem
  readonly reveal: SecretReveal
}

const internationalAccount = SecretComponentTestFixture.listItem({
  id: 'secret-iban',
  type: SecretType.InternationalAccount,
  displayTitle: 'Example Bank',
  summary: '•••• 5432 · NWBKGB2L',
  groupKey: 'Example Bank',
})

const domesticAccount = SecretComponentTestFixture.listItem({
  id: 'secret-us-bank',
  type: SecretType.DomesticAccount,
  displayTitle: 'US Bank',
  summary: '•••• 6789 · 021000021',
  groupKey: 'US Bank',
})

const identityDocument = SecretComponentTestFixture.listItem({
  id: 'secret-passport',
  type: SecretType.IdentityDocument,
  displayTitle: 'ADA LOVELACE',
  summary: '•••• 4567',
  groupKey: 'ADA LOVELACE',
})

function revealed(item: NookSecretListItem, view: PersonalDataView) {
  const reveal: SecretReveal = {
    kind: SecretRevealKind.Revealed,
    record: SecretComponentTestFixture.record({
      id: item.id,
      type: item.type,
      personalData: view,
    }),
  }
  return reveal
}

function renderDetail({ item, reveal }: DetailRender) {
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string'
      ? request
      : `${request.key}:${Object.values(request.replacements).join(',')}`,
  )
  const onCopyToClipboard = vi.fn(async () => {})
  const view = render(SecretDetail, {
    item,
    pageInteraction: SecretPageInteractionKind.Ready,
    reveal,
    onToggleReveal: vi.fn(async () => {}),
    onEditItem: vi.fn(async () => {}),
    onDeleteSecret: vi.fn(async () =>
      ok<SecretMutationOutcome.Deleted, never>(SecretMutationOutcome.Deleted),
    ),
    onCopyToClipboard,
    onCopySecret: vi.fn(async () => {}),
    vault,
  })
  return { view, onCopyToClipboard }
}

function copyButtons(slot: HTMLElement): HTMLElement[] {
  return within(slot).queryAllByRole('button')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('international account detail', () => {
  test('keeps the IBAN and the other fields sealed until reveal', () => {
    const request: DetailRender = {
      item: internationalAccount,
      reveal: { kind: SecretRevealKind.Hidden },
    }
    const { view } = renderDetail(request)

    expect(view.getByTestId('secret-detail-title').textContent).toContain(
      'Example Bank',
    )
    const iban = view.getByTestId('international-account-iban-value')
    expect(iban.textContent).not.toContain('5432')
    expect(
      view.getByTestId('international-account-swift-bic-value').textContent,
    ).not.toBe('NWBKGB2L')
    expect(
      copyButtons(view.getByTestId('personal-slot-international-account-iban')),
    ).toHaveLength(0)
  })

  test('shows the IBAN and SWIFT/BIC labels and copies the IBAN after reveal', async () => {
    const request: DetailRender = {
      item: internationalAccount,
      reveal: revealed(internationalAccount, {
        kind: 'international-account',
        accountHolder: 'Ada Lovelace',
        bankName: 'Example Bank',
        iban: 'GB82WEST12345698765432',
        maskedNumber: '•••• 5432',
        swiftBic: 'NWBKGB2L',
      }),
    }
    const { view, onCopyToClipboard } = renderDetail(request)

    const ibanSlot = view.getByTestId(
      'personal-slot-international-account-iban',
    )
    expect(ibanSlot.textContent).toContain(I18N_KEYS.VaultFieldsIban)
    expect(
      view.getByTestId('international-account-iban-value').textContent,
    ).toBe('GB82WEST12345698765432')
    expect(
      view.getByTestId('personal-slot-international-account-swift-bic')
        .textContent,
    ).toContain(I18N_KEYS.VaultFieldsSwiftBic)
    expect(
      view.getByTestId('international-account-swift-bic-value').textContent,
    ).toBe('NWBKGB2L')

    await fireEvent.click(within(ibanSlot).getByRole('button'))
    expect(onCopyToClipboard).toHaveBeenCalledWith({
      text: 'GB82WEST12345698765432',
      id: 'secret-iban',
      field: 'international-account-iban',
    })
  })
})

describe('US bank account detail', () => {
  test('keeps the account number sealed until reveal', () => {
    const request: DetailRender = {
      item: domesticAccount,
      reveal: { kind: SecretRevealKind.Hidden },
    }
    const { view } = renderDetail(request)

    expect(
      view.getByTestId('domestic-account-number-value').textContent,
    ).not.toContain('6789')
    expect(
      copyButtons(view.getByTestId('personal-slot-domestic-account-number')),
    ).toHaveLength(0)
  })

  test('shows account and routing numbers and leaves empty fields uncopyable', async () => {
    const request: DetailRender = {
      item: domesticAccount,
      reveal: revealed(domesticAccount, {
        kind: 'domestic-account',
        accountHolder: '',
        bankName: 'US Bank',
        accountNumber: '123456789',
        maskedNumber: '•••• 6789',
        routingNumber: '021000021',
      }),
    }
    const { view, onCopyToClipboard } = renderDetail(request)

    const numberSlot = view.getByTestId('personal-slot-domestic-account-number')
    expect(numberSlot.textContent).toContain(I18N_KEYS.VaultFieldsAccountNumber)
    expect(view.getByTestId('domestic-account-number-value').textContent).toBe(
      '123456789',
    )
    expect(
      view.getByTestId('personal-slot-domestic-account-routing-number')
        .textContent,
    ).toContain(I18N_KEYS.VaultFieldsRoutingNumber)
    expect(
      view.getByTestId('domestic-account-routing-number-value').textContent,
    ).toBe('021000021')
    expect(
      copyButtons(view.getByTestId('personal-slot-domestic-account-holder')),
    ).toHaveLength(0)

    await fireEvent.click(within(numberSlot).getByRole('button'))
    expect(onCopyToClipboard).toHaveBeenCalledWith({
      text: '123456789',
      id: 'secret-us-bank',
      field: 'domestic-account-number',
    })
  })
})

test('shows only the Rust masked tail of a document number before reveal', () => {
  const request: DetailRender = {
    item: identityDocument,
    reveal: { kind: SecretRevealKind.Hidden },
  }
  const { view } = renderDetail(request)

  expect(view.getByTestId('identity-document-number-value').textContent).toBe(
    '•••• 4567',
  )
})
