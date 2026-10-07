import { afterEach, describe, expect, test } from 'vitest'
import {
  FocusedCredentialOpportunity,
  FocusedCredentialRevalidation,
  NookPageInputFieldObservation,
  classify_companion_focused_credential_field,
  parse_page_input_type,
  revalidate_companion_focused_credential_field,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-forms'

class FocusedPolicyFixture {
  readonly input = document.createElement('input')
  observation() {
    const metadata = passwordFieldDiscovery.focusedFieldObservation(this.input)
    return new NookPageInputFieldObservation(
      parse_page_input_type(metadata.inputType),
      metadata.disabled,
      metadata.readOnly,
      [...metadata.autocompleteTokens],
      metadata.identityText,
      metadata.loginContext,
    )
  }
  classify(): FocusedCredentialOpportunity {
    const field = this.observation()
    try {
      const recognition = classify_companion_focused_credential_field(field)
      try {
        return recognition.opportunity
      } finally {
        recognition.free()
      }
    } finally {
      field.free()
    }
  }
  revalidate(
    opportunity: FocusedCredentialOpportunity,
  ): FocusedCredentialOpportunity {
    const field = this.observation()
    try {
      const request = new FocusedCredentialRevalidation(field).with_opportunity(
        opportunity,
      )
      try {
        const recognition =
          revalidate_companion_focused_credential_field(request)
        try {
          return recognition.opportunity
        } finally {
          recognition.free()
        }
      } finally {
        request.free()
      }
    } finally {
      field.free()
    }
  }
}

afterEach(() => document.body.replaceChildren())

describe('focused generated credential policy boundary', () => {
  test.each(['username', 'current-password'])(
    'recognizes %s without a detected page workflow',
    (autocomplete) => {
      const fixture = new FocusedPolicyFixture()
      fixture.input.setAttribute('autocomplete', autocomplete)
      switch (autocomplete) {
        case 'current-password':
          fixture.input.type = 'password'
          expect(fixture.classify()).toBe(
            FocusedCredentialOpportunity.CurrentPassword,
          )
          break
        case 'username':
          fixture.input.type = 'email'
          expect(fixture.classify()).toBe(FocusedCredentialOpportunity.Username)
          break
      }
    },
  )

  test.each([
    'search',
    'newsletter',
    'one-time-code',
    'new-password',
    'unrelated',
  ])('rejects %s metadata', (purpose) => {
    const fixture = new FocusedPolicyFixture()
    fixture.input.name = purpose
    fixture.input.setAttribute('autocomplete', purpose)
    expect(fixture.classify()).toBe(FocusedCredentialOpportunity.Unavailable)
  })

  test('revalidates expected semantic role using the real consuming generated request', () => {
    const fixture = new FocusedPolicyFixture()
    fixture.input.autocomplete = 'username'
    expect(fixture.revalidate(FocusedCredentialOpportunity.Username)).toBe(
      FocusedCredentialOpportunity.Username,
    )
    fixture.input.type = 'password'
    fixture.input.autocomplete = 'current-password'
    expect(fixture.revalidate(FocusedCredentialOpportunity.Username)).toBe(
      FocusedCredentialOpportunity.Unavailable,
    )
  })
})
