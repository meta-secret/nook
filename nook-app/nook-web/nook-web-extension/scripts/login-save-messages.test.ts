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
        Effect.either(
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
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginSavePendingMessageSchema.decode({
            type: 'nook:website-login-save-pending',
            payload: { origin: 'https://login.example.com' },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
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
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginSaveDismissMessageSchema.decode({
            type: 'nook:website-login-save-dismiss',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
  })

  test('rejects malformed save messages', () => {
    expect(
      Effect.runSync(
        Effect.either(
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
    ).toBe('Left')
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteLoginSaveCommitMessageSchema.decode({
            type: 'nook:website-login-save-commit',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
  })
})
