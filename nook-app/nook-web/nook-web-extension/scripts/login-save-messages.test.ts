import { describe, expect, test } from 'bun:test'
import {
  WebsiteLoginSaveActionResponseKind,
  WebsiteLoginSaveOfferResponseKind,
  isWebsiteLoginSaveActionResponse,
  isWebsiteLoginSaveCommitMessage,
  isWebsiteLoginSaveDismissMessage,
  isWebsiteLoginSaveOfferMessage,
  isWebsiteLoginSavePendingMessage,
  isWebsiteLoginSaveOfferResponse,
} from '../src/lib/login-save-messages'

describe('website login save runtime messages', () => {
  test('accepts typed save offer, pending, commit, and dismiss messages', () => {
    expect(
      isWebsiteLoginSaveOfferMessage({
        type: 'nook:website-login-save-offer',
        payload: {
          origin: 'https://login.example.com',
          username: 'alice@example.com',
          password: 'secret',
        },
      }),
    ).toBe(true)
    expect(
      isWebsiteLoginSavePendingMessage({
        type: 'nook:website-login-save-pending',
        payload: { origin: 'https://login.example.com' },
      }),
    ).toBe(true)
    expect(
      isWebsiteLoginSaveCommitMessage({
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
      isWebsiteLoginSaveDismissMessage({
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
      isWebsiteLoginSaveOfferMessage({
        type: 'nook:website-login-save-offer',
        payload: {
          origin: 'https://login.example.com',
          username: '',
          password: 'secret',
        },
      }),
    ).toBe(false)
    expect(
      isWebsiteLoginSaveCommitMessage({
        type: 'nook:website-login-save-commit',
        payload: { origin: 'https://login.example.com', offerId: 'offer_1' },
      }),
    ).toBe(false)
  })

  test('requires response variants to own their domain data', () => {
    expect(
      isWebsiteLoginSaveOfferResponse({
        kind: WebsiteLoginSaveOfferResponseKind.NotRequired,
      }),
    ).toBe(true)
    expect(
      isWebsiteLoginSaveOfferResponse({
        kind: WebsiteLoginSaveOfferResponseKind.OfferAvailable,
      }),
    ).toBe(false)
    expect(
      isWebsiteLoginSaveActionResponse({
        kind: WebsiteLoginSaveActionResponseKind.Rejected,
      }),
    ).toBe(false)
  })
})
