import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  WebsiteLoginSaveCommitMessage as WebsiteLoginSaveCommitMessageSchema,
  WebsiteLoginSaveDismissMessage as WebsiteLoginSaveDismissMessageSchema,
  WebsiteLoginSaveOfferMessage as WebsiteLoginSaveOfferMessageSchema,
  WebsiteLoginSavePendingMessage as WebsiteLoginSavePendingMessageSchema,
} from '../src/lib/login-save-messages'

describe('website login save runtime messages', () => {
  test('accepts typed save offer, pending, commit, and dismiss messages', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveOfferMessageSchema.decode({
            type: 'nook:website-login-save-offer',
            payload: {
              origin: 'https://login.example.com',
              username: 'alice@example.com',
              password: 'secret',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSavePendingMessageSchema.decode({
            type: 'nook:website-login-save-pending',
            payload: { origin: 'https://login.example.com' },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveCommitMessageSchema.decode({
            type: 'nook:website-login-save-commit',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
              evidence: {
                navigatedAwayFromAuthPath: true,
                authFieldsPresent: false,
                successMarkerPresent: true,
                errorMarkerPresent: false,
                sameDocumentMutation: false,
                inIframe: false,
                elapsedMs: 400,
              },
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveDismissMessageSchema.decode({
            type: 'nook:website-login-save-dismiss',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
  })

  test('rejects malformed save messages', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveOfferMessageSchema.decode({
            type: 'nook:website-login-save-offer',
            payload: {
              origin: 'https://login.example.com',
              username: '',
              password: 'secret',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveCommitMessageSchema.decode({
            type: 'nook:website-login-save-commit',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })
})
