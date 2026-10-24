import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte'
import { ok } from 'neverthrow'
import {
  NookSecretFormFields,
  SecretCategory,
  type PersonalDataView,
} from '$app-wasm'
import AddSecretForm from '$lib/components/AddSecretForm.svelte'
import { PersonalDataFormState } from '$lib/components/add-secret/personal-data-form-state.svelte'
import { SecretTypeSelectionKind } from '$lib/components/secret-form-state'
import { SecretEditorKind } from '$lib/components/secret-vault-state'
import { buildSecretYaml, SecretType } from '$lib/nook'
import {
  SecretMutationOutcome,
  type SecretOperationResult,
} from '$lib/vault/secret-operation-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { SecretComponentTestFixture } from './secret-component-test-fixture'

type SecretSubmission = {
  readonly type: SecretType
  readonly data: string
}

const vault = VaultStateTestFixture.create()

function translateKeys(): void {
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string' ? request : request.key,
  )
  vi.spyOn(vault, 'resolveErrorMessage').mockImplementation((error) => error)
}

function inputValue(element: HTMLElement): string {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement
  )
    return element.value
  return expect.fail('expected a form control')
}

function personalRecord(type: SecretType, view: PersonalDataView) {
  return SecretComponentTestFixture.record({
    id: `secret-${view.kind}`,
    type,
    personalData: view,
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('personal-data form state', () => {
  test('sends the person form as the typed Rust DTO', () => {
    const person = vi.spyOn(NookSecretFormFields, 'person')
    const state = new PersonalDataFormState()
    state.person.givenName = 'Ada'
    state.person.familyName = 'Lovelace'
    state.person.birthDate = '1815-12-10'
    state.person.email = 'ada@example.com'

    const yaml = buildSecretYaml(state.toFormFields(SecretType.Person))

    expect(person).toHaveBeenCalledWith({
      givenName: 'Ada',
      middleName: '',
      familyName: 'Lovelace',
      birthDate: '1815-12-10',
      email: 'ada@example.com',
      phone: '',
    })
    expect(yaml).toContain('Lovelace')
    expect(yaml).toContain('1815-12-10')
  })

  test('sends the address form as the typed Rust DTO', () => {
    const address = vi.spyOn(NookSecretFormFields, 'address')
    const state = new PersonalDataFormState()
    state.address.label = 'Home'
    state.address.addressLine1 = '1 Main Street'
    state.address.city = 'London'
    state.address.country = 'United Kingdom'

    const yaml = buildSecretYaml(state.toFormFields(SecretType.Address))

    expect(address).toHaveBeenCalledWith({
      label: 'Home',
      addressLine1: '1 Main Street',
      addressLine2: '',
      city: 'London',
      region: '',
      postalCode: '',
      country: 'United Kingdom',
    })
    expect(yaml).toContain('1 Main Street')
  })

  test('sends the identity document form with its document kind', () => {
    const identityDocument = vi.spyOn(NookSecretFormFields, 'identity_document')
    const state = new PersonalDataFormState()
    state.document.kind = 'drivers-license'
    state.document.number = 'D1234567'
    state.document.issueDate = '2020-01-01'
    state.document.expiryDate = '2030-01-01'

    const yaml = buildSecretYaml(
      state.toFormFields(SecretType.IdentityDocument),
    )

    expect(identityDocument).toHaveBeenCalledWith({
      kind: 'drivers-license',
      number: 'D1234567',
      issuingCountry: '',
      issueDate: '2020-01-01',
      expiryDate: '2030-01-01',
      nameAsPrinted: '',
    })
    expect(yaml).toContain('drivers-license')
  })

  test('sends the international account form as the typed Rust DTO', () => {
    const internationalAccount = vi.spyOn(
      NookSecretFormFields,
      'international_account',
    )
    const state = new PersonalDataFormState()
    state.internationalAccount.bankName = 'Example Bank'
    state.internationalAccount.accountHolder = 'Ada Lovelace'
    state.internationalAccount.iban = 'GB82 WEST 1234 5698 7654 32'
    state.internationalAccount.swiftBic = 'nwbk gb2l'

    const yaml = buildSecretYaml(
      state.toFormFields(SecretType.InternationalAccount),
    )

    expect(internationalAccount).toHaveBeenCalledWith({
      accountHolder: 'Ada Lovelace',
      bankName: 'Example Bank',
      iban: 'GB82 WEST 1234 5698 7654 32',
      swiftBic: 'nwbk gb2l',
    })
    expect(yaml).toContain('GB82WEST12345698765432')
    expect(yaml).toContain('NWBKGB2L')
  })

  test('sends the US bank account form as the typed Rust DTO', () => {
    const domesticAccount = vi.spyOn(NookSecretFormFields, 'domestic_account')
    const state = new PersonalDataFormState()
    state.domesticAccount.bankName = 'Example Bank'
    state.domesticAccount.accountHolder = 'Ada Lovelace'
    state.domesticAccount.accountNumber = '1234-5678-9'
    state.domesticAccount.routingNumber = '021000021'

    const yaml = buildSecretYaml(state.toFormFields(SecretType.DomesticAccount))

    expect(domesticAccount).toHaveBeenCalledWith({
      accountHolder: 'Ada Lovelace',
      bankName: 'Example Bank',
      accountNumber: '1234-5678-9',
      routingNumber: '021000021',
    })
    expect(yaml).toContain('123456789')
    expect(yaml).toContain('021000021')
  })

  test('reports the Rust validation keys for invalid bank details', () => {
    const state = new PersonalDataFormState()
    state.internationalAccount.iban = 'GB00 WEST 1234 5698 7654 32'
    state.domesticAccount.accountNumber = '123456789'
    state.domesticAccount.routingNumber = '021000022'

    expect(() =>
      buildSecretYaml(state.toFormFields(SecretType.InternationalAccount)),
    ).toThrow('international_account_iban_invalid')
    expect(() =>
      buildSecretYaml(state.toFormFields(SecretType.DomesticAccount)),
    ).toThrow('routing_number_invalid')
  })

  test('reports the Rust validation key for an invalid record', () => {
    const state = new PersonalDataFormState()
    state.document.expiryDate = '2020-01-01'
    state.document.issueDate = '2021-01-01'
    state.document.number = 'X1'

    expect(() =>
      buildSecretYaml(state.toFormFields(SecretType.IdentityDocument)),
    ).toThrow('identity_document_expiry_before_issue')
  })

  test('pre-fills each form from the Rust personal-data view', () => {
    const state = new PersonalDataFormState()
    state.load({
      kind: 'identity-document',
      documentKind: 'national-id',
      number: 'N998877',
      maskedNumber: '•••• 8877',
      issuingCountry: 'France',
      issueDate: '2019-05-01',
      expiryDate: '2029-05-01',
      nameAsPrinted: 'ADA LOVELACE',
    })
    state.load({
      kind: 'international-account',
      accountHolder: 'Ada Lovelace',
      bankName: 'Example Bank',
      iban: 'GB82WEST12345698765432',
      maskedNumber: '•••• 5432',
      swiftBic: 'NWBKGB2L',
    })
    state.load({
      kind: 'domestic-account',
      accountHolder: 'Ada Lovelace',
      bankName: 'US Bank',
      accountNumber: '123456789',
      maskedNumber: '•••• 6789',
      routingNumber: '021000021',
    })

    expect(state.document).toEqual({
      kind: 'national-id',
      number: 'N998877',
      issuingCountry: 'France',
      issueDate: '2019-05-01',
      expiryDate: '2029-05-01',
      nameAsPrinted: 'ADA LOVELACE',
    })
    expect(state.internationalAccount).toEqual({
      accountHolder: 'Ada Lovelace',
      bankName: 'Example Bank',
      iban: 'GB82WEST12345698765432',
      swiftBic: 'NWBKGB2L',
    })
    expect(state.domesticAccount).toEqual({
      accountHolder: 'Ada Lovelace',
      bankName: 'US Bank',
      accountNumber: '123456789',
      routingNumber: '021000021',
    })
  })
})

describe('personal-data add and edit forms', () => {
  test('creates a person and shows the Rust error when no name is given', async () => {
    translateKeys()
    const onAddSecret = vi
      .fn<
        (
          request: SecretSubmission & { readonly id: string },
        ) => Promise<SecretOperationResult<SecretMutationOutcome.Added>>
      >()
      .mockResolvedValue(ok(SecretMutationOutcome.Added))
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      section: SecretCategory.PersonalData,
      onAddSecret,
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
    })

    await fireEvent.click(view.getByTestId('item-type-person'))
    await fireEvent.input(view.getByTestId('person-email'), {
      target: { value: 'ada@example.com' },
    })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    const error = await view.findByTestId('secret-form-error')
    expect(error.textContent).toContain('person_name_required')
    expect(onAddSecret).not.toHaveBeenCalled()

    await fireEvent.input(view.getByTestId('person-given-name'), {
      target: { value: 'Ada' },
    })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    await waitFor(() => expect(onAddSecret).toHaveBeenCalledTimes(1))
    const [call] = onAddSecret.mock.calls
    if (!call) expect.fail('saving must add the person')
    const [request] = call
    expect(request.type).toBe(SecretType.Person)
    expect(request.data).toContain('ada@example.com')
  })

  test('pre-fills the person editor and replaces the record', async () => {
    translateKeys()
    const onReplaceSecret = vi
      .fn<
        (
          request: SecretSubmission & { readonly oldId: string },
        ) => Promise<SecretOperationResult<SecretMutationOutcome.Replaced>>
      >()
      .mockResolvedValue(ok(SecretMutationOutcome.Replaced))
    const record = personalRecord(SecretType.Person, {
      kind: 'person',
      givenName: 'Ada',
      middleName: 'King',
      familyName: 'Lovelace',
      fullName: 'Ada King Lovelace',
      birthDate: '1815-12-10',
      email: 'ada@example.com',
      phone: '+44 20 7946 0000',
    })
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret: vi.fn(),
      onReplaceSecret,
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
      editor: { kind: SecretEditorKind.Editing, record },
      selectedTypeState: {
        kind: SecretTypeSelectionKind.EditingFields,
        itemType: SecretType.Person,
      },
    })

    expect(inputValue(await view.findByTestId('person-given-name'))).toBe('Ada')
    expect(inputValue(view.getByTestId('person-middle-name'))).toBe('King')
    expect(inputValue(view.getByTestId('person-birth-date'))).toBe('1815-12-10')
    expect(inputValue(view.getByTestId('person-phone'))).toBe(
      '+44 20 7946 0000',
    )
    expect(view.getByTestId('person-birth-date').getAttribute('type')).toBe(
      'date',
    )

    await fireEvent.input(view.getByTestId('person-family-name'), {
      target: { value: 'Byron' },
    })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    await waitFor(() => expect(onReplaceSecret).toHaveBeenCalledTimes(1))
    const [call] = onReplaceSecret.mock.calls
    if (!call) expect.fail('editing must replace the person')
    const [request] = call
    expect(request.oldId).toBe('secret-person')
    expect(request.type).toBe(SecretType.Person)
    expect(request.data).toContain('Byron')
  })

  test('pre-fills the document editor with its kind and a concealed number', async () => {
    translateKeys()
    const record = personalRecord(SecretType.IdentityDocument, {
      kind: 'identity-document',
      documentKind: 'passport',
      number: 'P1234567',
      maskedNumber: '•••• 4567',
      issuingCountry: 'Germany',
      issueDate: '2020-02-03',
      expiryDate: '2030-02-02',
      nameAsPrinted: 'ADA LOVELACE',
    })
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret: vi.fn(),
      onReplaceSecret: vi.fn(),
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
      editor: { kind: SecretEditorKind.Editing, record },
      selectedTypeState: {
        kind: SecretTypeSelectionKind.EditingFields,
        itemType: SecretType.IdentityDocument,
      },
    })

    expect(inputValue(await view.findByTestId('identity-document-kind'))).toBe(
      'passport',
    )
    const number = view.getByTestId('identity-document-number')
    expect(inputValue(number)).toBe('P1234567')
    expect(number.getAttribute('type')).toBe('password')
    await fireEvent.click(
      view.getByTestId('toggle-identity-document-number-visibility'),
    )
    expect(number.getAttribute('type')).toBe('text')
    expect(inputValue(view.getByTestId('identity-document-expiry-date'))).toBe(
      '2030-02-02',
    )
  })

  test('creates an international account with a concealed IBAN and a plain SWIFT/BIC', async () => {
    translateKeys()
    const onAddSecret = vi
      .fn<
        (
          request: SecretSubmission & { readonly id: string },
        ) => Promise<SecretOperationResult<SecretMutationOutcome.Added>>
      >()
      .mockResolvedValue(ok(SecretMutationOutcome.Added))
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      section: SecretCategory.PersonalData,
      onAddSecret,
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
    })

    await fireEvent.click(view.getByTestId('item-type-international-account'))
    const iban = view.getByTestId('international-account-iban')
    const swiftBic = view.getByTestId('international-account-swift-bic')
    expect(iban.getAttribute('type')).toBe('password')
    expect(swiftBic.getAttribute('type')).toBe('text')
    expect(view.getByText(I18N_KEYS.VaultFieldsIban)).toBeTruthy()
    expect(view.getByText(I18N_KEYS.VaultFieldsSwiftBic)).toBeTruthy()

    await fireEvent.input(iban, {
      target: { value: 'GB82 WEST 1234 5698 7654 32' },
    })
    await fireEvent.input(swiftBic, { target: { value: 'NWBKGB2L' } })
    await fireEvent.click(view.getByTestId('save-secret-btn'))

    await waitFor(() => expect(onAddSecret).toHaveBeenCalledTimes(1))
    const [call] = onAddSecret.mock.calls
    if (!call) expect.fail('saving must add the international account')
    const [request] = call
    expect(request.type).toBe(SecretType.InternationalAccount)
    expect(request.data).toContain('GB82WEST12345698765432')
  })

  test('pre-fills the US bank account editor with a concealed account number', async () => {
    translateKeys()
    const record = personalRecord(SecretType.DomesticAccount, {
      kind: 'domestic-account',
      accountHolder: 'Ada Lovelace',
      bankName: 'US Bank',
      accountNumber: '123456789',
      maskedNumber: '•••• 6789',
      routingNumber: '021000021',
    })
    const view = render(AddSecretForm, {
      vault,
      isSaving: false,
      onAddSecret: vi.fn(),
      onReplaceSecret: vi.fn(),
      onGeneratePassword: vi.fn(() => ''),
      onCancel: vi.fn(),
      editor: { kind: SecretEditorKind.Editing, record },
      selectedTypeState: {
        kind: SecretTypeSelectionKind.EditingFields,
        itemType: SecretType.DomesticAccount,
      },
    })

    const number = await view.findByTestId('domestic-account-number')
    expect(inputValue(number)).toBe('123456789')
    expect(number.getAttribute('type')).toBe('password')
    const routing = view.getByTestId('domestic-account-routing-number')
    expect(inputValue(routing)).toBe('021000021')
    expect(routing.getAttribute('type')).toBe('text')
    expect(view.getByText(I18N_KEYS.VaultFieldsAccountNumber)).toBeTruthy()
    expect(view.getByText(I18N_KEYS.VaultFieldsRoutingNumber)).toBeTruthy()
  })
})
