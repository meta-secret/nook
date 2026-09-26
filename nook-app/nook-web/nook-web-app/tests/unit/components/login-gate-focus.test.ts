import { afterEach, describe, expect, test } from 'vitest'
import { IdentityContextFocusRestoration } from '../../../../nook-web-shared/src/vault-app/lib/components/login-gate-focus'

afterEach(() => {
  document.body.replaceChildren()
})

describe('login gate identity focus restoration', () => {
  test('focuses the review action while focus remains at the document host', async () => {
    document.body.innerHTML =
      '<button data-testid="login-review-identities"></button>'

    await new IdentityContextFocusRestoration({
      waitForNextFrame: async () => {},
      identityContextLoading: () => false,
      reviewButton: () =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="login-review-identities"]',
        ) || false,
    }).restoreWhenAvailable()

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-review-identities',
    )
  })

  test('does not take focus from another active control', async () => {
    document.body.innerHTML =
      '<button data-testid="other-focus-target"></button><button data-testid="login-review-identities"></button>'
    document
      .querySelector<HTMLButtonElement>('[data-testid="other-focus-target"]')
      ?.focus()

    await new IdentityContextFocusRestoration({
      waitForNextFrame: async () => {},
      identityContextLoading: () => false,
      reviewButton: () =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="login-review-identities"]',
        ) || false,
    }).restoreWhenAvailable()

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'other-focus-target',
    )
  })

  test('refocuses the latest review action when identity context remounts', async () => {
    document.body.innerHTML =
      '<button data-testid="login-review-identities"></button>'
    let replacementQueued = false

    await new IdentityContextFocusRestoration({
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
    }).restoreWhenAvailable()

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

    await new IdentityContextFocusRestoration({
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
    }).restoreWhenAvailable()

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-unlock-method-keys',
    )
  })

  test('keeps the keys method focused when Tab occurs during the loading wait', async () => {
    document.body.innerHTML =
      '<button data-testid="login-review-identities"></button><button data-testid="login-unlock-method-keys"></button>'
    let frame = 0
    let identityContextIsLoading = true

    await new IdentityContextFocusRestoration({
      waitForNextFrame: async () => {
        frame += 1
        switch (frame) {
          case 2:
            document
              .querySelector<HTMLButtonElement>(
                '[data-testid="login-unlock-method-keys"]',
              )
              ?.focus()
            identityContextIsLoading = false
            break
          default:
            break
        }
      },
      identityContextLoading: () => identityContextIsLoading,
      reviewButton: () =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="login-review-identities"]',
        ) || false,
    }).restoreWhenAvailable()

    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'login-unlock-method-keys',
    )
  })
})
