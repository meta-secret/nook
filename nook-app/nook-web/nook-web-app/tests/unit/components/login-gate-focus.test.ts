import { afterEach, describe, expect, test } from 'vitest'
import { focusIdentityContextWhenAvailable } from '../../../../nook-web-shared/src/vault-app/lib/components/login-gate-focus'

afterEach(() => {
  document.body.replaceChildren()
})

describe('login gate identity focus restoration', () => {
  test('focuses the remounted review action despite an unrelated active element', async () => {
    document.body.innerHTML =
      '<button data-testid="other-focus-target"></button><button data-testid="login-review-identities"></button>'
    document
      .querySelector<HTMLButtonElement>('[data-testid="other-focus-target"]')
      ?.focus()

    await focusIdentityContextWhenAvailable({
      waitForNextFrame: async () => {},
      identityContextLoading: () => false,
      reviewButton: () =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="login-review-identities"]',
        ),
    })

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-review-identities',
    )
  })
})
