import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte'
import PersonalDataFields from '$lib/components/add-secret/PersonalDataFields.svelte'
import { PersonalDataFormState } from '$lib/components/add-secret/personal-data-form-state.svelte'
import { SecretType } from '$lib/nook'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const vault = VaultStateTestFixture.create()

function renderDocumentForm() {
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string' ? request : request.key,
  )
  const state = new PersonalDataFormState()
  const view = render(PersonalDataFields, {
    vault,
    state,
    selectedType: SecretType.IdentityDocument,
  })
  return { state, view }
}

function checkedStates(group: HTMLElement): string[] {
  return Array.from(group.querySelectorAll('[role="radio"]'), (tile) =>
    String(tile.getAttribute('aria-checked')),
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('offers every document kind as an in-app radio group', () => {
  const { view } = renderDocumentForm()

  const group = view.getByTestId('identity-document-kind')
  expect(group.getAttribute('role')).toBe('radiogroup')
  expect(group.tagName).not.toBe('SELECT')
  expect(
    Array.from(group.querySelectorAll('[role="radio"]'), (tile) =>
      tile.getAttribute('data-testid'),
    ),
  ).toEqual([
    'identity-document-kind-passport',
    'identity-document-kind-national-id',
    'identity-document-kind-drivers-license',
    'identity-document-kind-social-security',
    'identity-document-kind-tax-id',
    'identity-document-kind-membership',
  ])
  expect(checkedStates(group)).toEqual([
    'true',
    'false',
    'false',
    'false',
    'false',
    'false',
  ])
  expect(
    view
      .getByTestId('identity-document-kind-passport')
      .getAttribute('tabindex'),
  ).toBe('0')
  expect(
    view.getByTestId('identity-document-kind-tax-id').getAttribute('tabindex'),
  ).toBe('-1')
})

test('clicking a plate chooses its kind and relabels the issuer for memberships', async () => {
  const { state, view } = renderDocumentForm()

  await fireEvent.click(view.getByTestId('identity-document-kind-membership'))

  expect(state.document.kind).toBe('membership')
  expect(
    view
      .getByTestId('identity-document-kind-membership')
      .getAttribute('aria-checked'),
  ).toBe('true')
  expect(
    view.getByText(I18N_KEYS.VaultFieldsMembershipOrganization),
  ).toBeTruthy()

  await fireEvent.click(view.getByTestId('identity-document-kind-tax-id'))
  expect(state.document.kind).toBe('tax-id')
  expect(view.getByText(I18N_KEYS.VaultFieldsDocumentIssuer)).toBeTruthy()
})

test('arrow keys move the choice and focus, wrapping at both ends', async () => {
  const { state, view } = renderDocumentForm()
  const passport = view.getByTestId('identity-document-kind-passport')
  passport.focus()

  await fireEvent.keyDown(passport, { key: 'ArrowRight' })
  expect(state.document.kind).toBe('national-id')
  await waitFor(() =>
    expect(document.activeElement).toBe(
      view.getByTestId('identity-document-kind-national-id'),
    ),
  )

  await fireEvent.keyDown(
    view.getByTestId('identity-document-kind-national-id'),
    { key: 'ArrowUp' },
  )
  expect(state.document.kind).toBe('passport')

  await fireEvent.keyDown(view.getByTestId('identity-document-kind-passport'), {
    key: 'ArrowLeft',
  })
  expect(state.document.kind).toBe('membership')
  await waitFor(() =>
    expect(document.activeElement).toBe(
      view.getByTestId('identity-document-kind-membership'),
    ),
  )

  await fireEvent.keyDown(
    view.getByTestId('identity-document-kind-membership'),
    { key: 'ArrowDown' },
  )
  expect(state.document.kind).toBe('passport')
  expect(
    view
      .getByTestId('identity-document-kind-passport')
      .getAttribute('tabindex'),
  ).toBe('0')
})
