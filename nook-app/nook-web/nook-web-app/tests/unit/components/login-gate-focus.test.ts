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
        ) || false,
    })

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-review-identities',
    )
  })

  test('refocuses the latest review action when identity context remounts', async () => {
    document.body.innerHTML =
      '<button data-testid="login-review-identities"></button>'
    let replacementQueued = false

    await focusIdentityContextWhenAvailable({
      waitForNextFrame: async () => {},
      identityContextLoading: () => false,
      reviewButton: () => {
        const reviewButton = document.querySelector<HTMLButtonElement>(
          '[data-testid="login-review-identities"]',
        )
        if (reviewButton && !replacementQueued) {
          replacementQueued = true
          queueMicrotask(() => {
            const replacement = document.createElement('button')
            replacement.dataset.testid = 'login-review-identities'
            reviewButton.replaceWith(replacement)
          })
        }
        return reviewButton || false
      },
    })

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-review-identities',
    )
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="login-review-identities"]'),
    )
  })

  test('does not reclaim focus after the user navigates away', async () => {
    document.body.innerHTML =
      '<button data-testid="login-review-identities"></button><button data-testid="login-unlock-method-keys"></button>'
    let frame = 0

    await focusIdentityContextWhenAvailable({
      waitForNextFrame: async () => {
        frame += 1
        if (frame === 2) {
          document
            .querySelector<HTMLButtonElement>(
              '[data-testid="login-unlock-method-keys"]',
            )
            ?.focus()
        }
      },
      identityContextLoading: () => false,
      reviewButton: () =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="login-review-identities"]',
        ) || false,
    })

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-unlock-method-keys',
    )
  })
})
