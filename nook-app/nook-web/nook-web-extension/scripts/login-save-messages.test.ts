import { describe, expect, test } from 'bun:test'
import {
  WebsiteLoginSaveCommitMessage as WebsiteLoginSaveCommitMessageSchema,
  WebsiteLoginSaveDismissMessage as WebsiteLoginSaveDismissMessageSchema,
  WebsiteLoginSaveOfferMessage as WebsiteLoginSaveOfferMessageSchema,
  WebsiteLoginSavePendingMessage as WebsiteLoginSavePendingMessageSchema,
} from '../src/lib/login-save-messages'

describe('website login save runtime messages', () => {
  test('accepts typed save offer, pending, commit, and dismiss messages', () => {
    expect(
      WebsiteLoginSaveOfferMessageSchema.is({
        type: 'nook:website-login-save-offer',
        payload: {
          origin: 'https://login.example.com',
          username: 'alice@example.com',
          password: 'secret',
        },
      }),
    ).toBe(true)
    expect(
      WebsiteLoginSavePendingMessageSchema.is({
        type: 'nook:website-login-save-pending',
        payload: { origin: 'https://login.example.com' },
      }),
    ).toBe(true)
    expect(
      WebsiteLoginSaveCommitMessageSchema.is({
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
    ).toBe(true)
    expect(
      WebsiteLoginSaveDismissMessageSchema.is({
        type: 'nook:website-login-save-dismiss',
        payload: {
          origin: 'https://login.example.com',
          offerId: 'offer_1',
        },
      }),
    ).toBe(true)
  })

  test('rejects malformed save messages', () => {
    expect(
      WebsiteLoginSaveOfferMessageSchema.is({
        type: 'nook:website-login-save-offer',
        payload: {
          origin: 'https://login.example.com',
          username: '',
          password: 'secret',
        },
      }),
    ).toBe(false)
    expect(
      WebsiteLoginSaveCommitMessageSchema.is({
        type: 'nook:website-login-save-commit',
        payload: { origin: 'https://login.example.com', offerId: 'offer_1' },
      }),
    ).toBe(false)
  })
})
