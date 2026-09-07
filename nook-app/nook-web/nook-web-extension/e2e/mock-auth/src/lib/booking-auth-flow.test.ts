import { describe, expect, test } from 'bun:test'

import siteShells from '../../fixtures/site-shells.json'
import bookingTemplate from '../../fixtures/templates/booking.json'
import {
  BOOKING_MOCK_EMAIL,
  BookingAuthControl,
  BookingAuthEmailMatch,
  BookingAuthInteractionState,
  BookingAuthMockScenario,
  BookingAuthPresentationState,
  BookingAuthPrimaryActivationState,
  BookingAuthTransitionKind,
  type BookingAuthSubmission,
} from './booking-auth-flow'

describe('Booking.com authentication mock', () => {
  const emailContinuation: BookingAuthSubmission = {
    email: BOOKING_MOCK_EMAIL,
    submittedControl: BookingAuthControl.ContinueWithEmail,
    primaryActivation: BookingAuthPrimaryActivationState.Activated,
    googleInteraction: BookingAuthInteractionState.Untouched,
    appleInteraction: BookingAuthInteractionState.Untouched,
    facebookInteraction: BookingAuthInteractionState.Untouched,
    recoveryInteraction: BookingAuthInteractionState.Untouched,
    brandInteraction: BookingAuthInteractionState.Untouched,
    disclosureInteraction: BookingAuthInteractionState.Untouched,
    helpInteraction: BookingAuthInteractionState.Untouched,
    languageInteraction: BookingAuthInteractionState.Untouched,
  }

  test('completes only through the observed email continuation', () => {
    expect(BookingAuthMockScenario.transition(emailContinuation)).toBe(
      BookingAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different email', { email: 'other@nook.test' }],
    ['Google', { submittedControl: BookingAuthControl.ContinueWithGoogle }],
    ['Apple', { submittedControl: BookingAuthControl.ContinueWithApple }],
    ['Facebook', { submittedControl: BookingAuthControl.ContinueWithFacebook }],
    ['recovery', { submittedControl: BookingAuthControl.RecoverAccount }],
    [
      'an unknown control',
      { submittedControl: BookingAuthControl.Unrecognized },
    ],
    [
      'no primary activation',
      { primaryActivation: BookingAuthPrimaryActivationState.Untouched },
    ],
    [
      'repeated primary activation',
      { primaryActivation: BookingAuthPrimaryActivationState.Repeated },
    ],
    [
      'Google activation',
      { googleInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'Apple activation',
      { appleInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'Facebook activation',
      { facebookInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'recovery activation',
      { recoveryInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'brand activation',
      { brandInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'disclosure activation',
      { disclosureInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'help activation',
      { helpInteraction: BookingAuthInteractionState.Activated },
    ],
    [
      'language activation',
      { languageInteraction: BookingAuthInteractionState.Activated },
    ],
  ])('rejects %s', (_, changed) => {
    expect(
      BookingAuthMockScenario.transition({
        ...emailContinuation,
        ...changed,
      }),
    ).toBe(BookingAuthTransitionKind.Rejected)
  })

  test('normalizes only captured control labels and presentation states', () => {
    expect(BookingAuthMockScenario.emailMatch(BOOKING_MOCK_EMAIL)).toBe(
      BookingAuthEmailMatch.Matched,
    )
    expect(BookingAuthMockScenario.emailMatch('other@nook.test')).toBe(
      BookingAuthEmailMatch.Different,
    )
    expect(
      BookingAuthMockScenario.submittedControl(' Continue with email '),
    ).toBe(BookingAuthControl.ContinueWithEmail)
    expect(BookingAuthMockScenario.submittedControl('Primary action')).toBe(
      BookingAuthControl.Unrecognized,
    )
    expect(BookingAuthPresentationState.Ready).toBe('ready')
    expect(BookingAuthPresentationState.Rejected).toBe('rejected')
  })

  test('promotes only the observed consumer route to the captured shell', () => {
    expect(siteShells.booking).toEqual({
      loginUrl: 'https://account.booking.com/sign-in',
      source: 'capture',
      template: 'booking',
    })
    expect(siteShells['booking-affiliate']).toEqual({
      loginUrl: 'https://www.booking.com/login',
      source: 'research',
      template: 'email-password',
    })
    expect(bookingTemplate).toEqual({
      id: 'booking',
      quirks: [
        'form-method-omitted',
        'form-action-omitted',
        'provider-alternatives-inside-form',
        'account-recovery-inside-form',
      ],
      steps: [
        {
          fields: [
            {
              type: 'email',
              name: 'username',
              autocomplete: 'username webauthn',
              placeholder: 'Enter your email address',
              'aria-label': 'Email address',
            },
          ],
          submit: { type: 'submit', label: 'Continue with email' },
        },
      ],
    })
  })
})
