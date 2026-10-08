import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  MAX_AUTHENTICATOR_SEARCH_LENGTH,
  AuthenticatorPickerCancelMessage as AuthenticatorPickerCancelMessageSchema,
  AuthenticatorPickerQueryMessage as AuthenticatorPickerQueryMessageSchema,
  AuthenticatorPickerQueryResponse as AuthenticatorPickerQueryResponseSchema,
  AuthenticatorPickerSelectMessage as AuthenticatorPickerSelectMessageSchema,
  WebsiteAuthenticatorCanceledMessage as WebsiteAuthenticatorCanceledMessageSchema,
  WebsiteAuthenticatorPickerOpenMessage as WebsiteAuthenticatorPickerOpenMessageSchema,
  WebsiteAuthenticatorSelectedMessage as WebsiteAuthenticatorSelectedMessageSchema,
} from '../src/lib/authenticator-picker-messages'

describe('authenticator picker messages', () => {
  test('accepts bounded picker requests', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorPickerOpenMessageSchema.decode({
            type: 'nook:website-authenticator-picker-open',
            payload: { origin: 'https://example.test' },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerQueryMessageSchema.decode({
            type: 'nook:authenticator-picker-query',
            payload: { requestId: 'picker-1', query: 'alice' },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerSelectMessageSchema.decode({
            type: 'nook:authenticator-picker-select',
            payload: {
              requestId: 'picker-1',
              vaultStoreId: 'vault-1',
              secretId: 'secret-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerCancelMessageSchema.decode({
            type: 'nook:authenticator-picker-cancel',
            payload: { requestId: 'picker-1' },
          }),
        ),
      )._tag,
    ).toBe('Success')
  })

  test('rejects oversized search text and incomplete selections', () => {
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerQueryMessageSchema.decode({
            type: 'nook:authenticator-picker-query',
            payload: {
              requestId: 'picker-1',
              query: 'x'.repeat(MAX_AUTHENTICATOR_SEARCH_LENGTH + 1),
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerSelectMessageSchema.decode({
            type: 'nook:authenticator-picker-select',
            payload: {
              requestId: 'picker-1',
              vaultStoreId: '',
              secretId: 'secret-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })

  test('admits only complete authenticator query responses', () => {
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerQueryResponseSchema.decode({
            ok: true,
            origin: 'https://accounts.example.test',
            accounts: [
              {
                vaultStoreId: 'vault-1',
                vaultName: 'Personal',
                secretId: 'secret-1',
                issuer: 'Example',
                account: 'alice@example.test',
              },
            ],
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          AuthenticatorPickerQueryResponseSchema.decode({
            ok: true,
            origin: 'https://accounts.example.test',
            accounts: [{ vaultStoreId: 'vault-1' }],
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })

  test('accepts only complete background selections', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorSelectedMessageSchema.decode({
            type: 'nook:website-authenticator-selected',
            payload: {
              origin: 'https://example.test',
              requestId: 'picker-1',
              account: {
                vaultStoreId: 'vault-1',
                secretId: 'secret-1',
                authorizationGeneration: 'epoch-7',
              },
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorSelectedMessageSchema.decode({
            type: 'nook:website-authenticator-selected',
            payload: {
              origin: 'https://example.test',
              requestId: 'picker-1',
              account: { vaultStoreId: 'vault-1' },
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorCanceledMessageSchema.decode({
            type: 'nook:website-authenticator-canceled',
            payload: {
              origin: 'https://example.test',
              requestId: 'picker-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorCanceledMessageSchema.decode({
            type: 'nook:website-authenticator-canceled',
            payload: { origin: 'https://example.test' },
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })
})
