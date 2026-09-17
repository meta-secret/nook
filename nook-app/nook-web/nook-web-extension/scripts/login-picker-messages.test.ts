import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  MAX_LOGIN_SEARCH_LENGTH,
  LoginPickerCancelMessage as LoginPickerCancelMessageSchema,
  LoginPickerQueryMessage as LoginPickerQueryMessageSchema,
  LoginPickerQueryResponse as LoginPickerQueryResponseSchema,
  LoginPickerSelectMessage as LoginPickerSelectMessageSchema,
  WebsiteLoginCanceledMessage as WebsiteLoginCanceledMessageSchema,
  WebsiteLoginPickerOpenMessage as WebsiteLoginPickerOpenMessageSchema,
  WebsiteLoginSelectedMessage as WebsiteLoginSelectedMessageSchema,
} from '../src/lib/login-picker-messages'

describe('login picker runtime messages', () => {
  test('accepts open messages with a non-empty origin', () => {
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginPickerOpenMessageSchema.decode({
            type: 'nook:website-login-picker-open',
            payload: { origin: 'https://login.example.test' },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginPickerOpenMessageSchema.decode({
            type: 'nook:website-login-picker-open',
            payload: { origin: '' },
          }),
        ),
      )._tag,
    ).toBe('Left')
  })

  test('bounds query length and requires a request id', () => {
    expect(
      Effect.runSync(
        Effect.either(
          LoginPickerQueryMessageSchema.decode({
            type: 'nook:login-picker-query',
            payload: { requestId: 'req-1', query: 'alice' },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          LoginPickerQueryMessageSchema.decode({
            type: 'nook:login-picker-query',
            payload: {
              requestId: 'req-1',
              query: 'a'.repeat(MAX_LOGIN_SEARCH_LENGTH + 1),
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
  })

  test('admits only complete login query responses', () => {
    expect(
      Effect.runSync(
        Effect.either(
          LoginPickerQueryResponseSchema.decode({
            ok: true,
            origin: 'https://login.example.test',
            accounts: [
              {
                vaultStoreId: 'vault-1',
                secretId: 'secret-1',
                username: 'alice',
                websiteHost: 'login.example.test',
                websiteUrl: 'https://login.example.test',
                vaultName: 'Personal',
              },
            ],
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          LoginPickerQueryResponseSchema.decode({
            ok: true,
            origin: 'https://login.example.test',
            accounts: [{ vaultStoreId: 'vault-1' }],
          }),
        ),
      )._tag,
    ).toBe('Left')
  })

  test('requires select and cancel identity fields', () => {
    expect(
      Effect.runSync(
        Effect.either(
          LoginPickerSelectMessageSchema.decode({
            type: 'nook:login-picker-select',
            payload: {
              requestId: 'req-1',
              vaultStoreId: 'vault-1',
              secretId: 'secret-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          LoginPickerCancelMessageSchema.decode({
            type: 'nook:login-picker-cancel',
            payload: { requestId: 'req-1' },
          }),
        ),
      )._tag,
    ).toBe('Right')
  })

  test('accepts selected and canceled page callbacks', () => {
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginSelectedMessageSchema.decode({
            type: 'nook:website-login-selected',
            payload: {
              origin: 'https://login.example.test',
              requestId: 'req-1',
              account: {
                vaultStoreId: 'vault-1',
                secretId: 'secret-1',
                authorizationGeneration: 'epoch-7',
              },
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginCanceledMessageSchema.decode({
            type: 'nook:website-login-canceled',
            payload: {
              origin: 'https://login.example.test',
              requestId: 'req-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
  })
})
