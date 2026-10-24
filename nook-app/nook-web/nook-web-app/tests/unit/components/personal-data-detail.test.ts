import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { ok } from 'neverthrow'
import SecretDetail from '$lib/components/vault/SecretDetail.svelte'
import {
  SecretPageInteractionKind,
  SecretRevealKind,
  type SecretReveal,
} from '$lib/components/secret-vault-state'
import { SecretType } from '$lib/nook'
import { SecretMutationOutcome } from '$lib/vault/secret-operation-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

const vault = VaultStateTestFixture.create()

const bankAccount = SecretComponentTestFixture.listItem({
  id: 'secret-bank',
  type: SecretType.BankAccount,
  displayTitle: 'Example Bank',
  summary: '•••• 5432',
  groupKey: 'Example Bank',
})

const revealedBankAccount: SecretReveal = {
  kind: SecretRevealKind.Revealed,
  record: SecretComponentTestFixture.record({
    id: 'secret-bank',
    type: SecretType.BankAccount,
    personalData: {
      kind: 'bank-account',
      accountHolder: 'Ada Lovelace',
      bankName: 'Example Bank',
      accountNumber: 'GB82WEST12345698765432',
      maskedNumber: '•••• 5432',
      routingCode: '',
    },
  }),
}

function renderDetail(reveal: SecretReveal) {
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string'
      ? request
      : `${request.key}:${Object.values(request.replacements).join(',')}`,
  )
  const onCopyToClipboard = vi.fn(async () => {})
  const view = render(SecretDetail, {
    item: bankAccount,
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('keeps the account number masked until the record is revealed', () => {
  const { view } = renderDetail({ kind: SecretRevealKind.Hidden })

  expect(view.getByTestId('secret-detail-title').textContent).toContain(
    'Example Bank',
  )
  expect(view.getByTestId('bank-account-number-value').textContent).toBe(
    '•••• 5432',
  )
  expect(view.getByTestId('bank-account-holder-value').textContent).not.toBe(
    'Ada Lovelace',
  )
  expect(
    within(view.getByTestId('personal-slot-bank-account-number')).queryByRole(
      'button',
    ),
  ).toBeNull()
})

test('shows and copies the full account number after an explicit reveal', async () => {
  const { view, onCopyToClipboard } = renderDetail(revealedBankAccount)

  expect(view.getByTestId('bank-account-number-value').textContent).toBe(
    'GB82WEST12345698765432',
  )
  expect(view.getByTestId('bank-account-holder-value').textContent).toBe(
    'Ada Lovelace',
  )
  expect(
    within(
      view.getByTestId('personal-slot-bank-account-routing-code'),
    ).queryByRole('button'),
  ).toBeNull()

  await fireEvent.click(
    within(view.getByTestId('personal-slot-bank-account-number')).getByRole(
      'button',
    ),
  )
  expect(onCopyToClipboard).toHaveBeenCalledWith({
    text: 'GB82WEST12345698765432',
    id: 'secret-bank',
    field: 'bank-account-number',
  })
})
