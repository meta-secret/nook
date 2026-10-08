import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  openLoginProviderSetup,
  UI_TIMEOUT_MS,
} from '../helpers'
import { Effect, Schema } from 'effect'
import enLocale from '../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }
import ruLocale from '../../../../nook-platform/nook-app-common/locales/ru.json' with { type: 'json' }

enum OpenedUrlsDecodeKind {
  Valid = 'valid',
  Invalid = 'invalid',
}

type OpenedUrlsDecode =
  | { kind: OpenedUrlsDecodeKind.Valid; urls: readonly string[] }
  | { kind: OpenedUrlsDecodeKind.Invalid }

enum DemoLocale {
  English = 'english',
  Russian = 'russian',
}

enum DemoLocalePrefix {
  English = 'en',
  Russian = 'ru',
}

function decodeOpenedUrls(
  serialized: unknown,
): Effect.Effect<OpenedUrlsDecode> {
  return Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(Schema.String)),
  )(serialized).pipe(
    Effect.map((urls): OpenedUrlsDecode => ({
      kind: OpenedUrlsDecodeKind.Valid,
      urls,
    })),
    Effect.catch(() =>
      Effect.succeed<OpenedUrlsDecode>({
        kind: OpenedUrlsDecodeKind.Invalid,
      }),
    ),
  )
}

function openedUrlsFromDecode(result: OpenedUrlsDecode): readonly string[] {
  switch (result.kind) {
    case OpenedUrlsDecodeKind.Valid:
      return result.urls
    case OpenedUrlsDecodeKind.Invalid:
      throw new Error(
        'Expected the demo to record a valid array of opened URLs',
      )
  }
}

function localeTimeoutCopy(localeValue: unknown): string {
  return Effect.runSync(
    Schema.decodeUnknownEffect(Schema.String)(localeValue).pipe(
      Effect.map((locale) => {
        switch (locale.slice(0, 2)) {
          case DemoLocalePrefix.English:
            return DemoLocale.English
          case DemoLocalePrefix.Russian:
            return DemoLocale.Russian
          default:
            return DemoLocale.English
        }
      }),
      Effect.catch(() => Effect.succeed(DemoLocale.English)),
      Effect.map((locale) => {
        switch (locale) {
          case DemoLocale.English:
            return enLocale.provider_setup.icloud_sign_in_timeout
          case DemoLocale.Russian:
            return ruLocale.provider_setup.icloud_sign_in_timeout
        }
      }),
    ),
  )
}

test('shows retry guidance when native Apple sign-in times out', async ({
  page,
}) => {
  const appleSignInUrl = 'https://idmsa.apple.com/appleauth/auth/signin'
  expect(
    Effect.runSync(decodeOpenedUrls(JSON.stringify([appleSignInUrl]))),
  ).toEqual({
    kind: OpenedUrlsDecodeKind.Valid,
    urls: [appleSignInUrl],
  })
  expect(Effect.runSync(decodeOpenedUrls('{invalid-json'))).toEqual({
    kind: OpenedUrlsDecodeKind.Invalid,
  })
  expect(
    Effect.runSync(decodeOpenedUrls(JSON.stringify([appleSignInUrl, 1]))),
  ).toEqual({ kind: OpenedUrlsDecodeKind.Invalid })

  await page.clock.install()
  await page.route('https://localhost:5173/**', async (route) => {
    const localRequestUrl = new URL(route.request().url())
    localRequestUrl.protocol = 'http:'
    localRequestUrl.hostname = '127.0.0.1'
    localRequestUrl.port = '5183'
    await route.fulfill({
      response: await route.fetch({ url: localRequestUrl.toString() }),
    })
  })
  await page.route('https://api.apple-cloudkit.com/**', (route) =>
    route.abort(),
  )
  await page.route('https://cdn.apple-cloudkit.com/**', (route) =>
    route.abort(),
  )
  await page.addInitScript(() => {
    const openedUrls: string[] = []
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: (url?: string | URL) => {
        openedUrls.push(String(url))
        document.documentElement.setAttribute(
          'data-demo-opened-urls',
          JSON.stringify(openedUrls),
        )
        return window
      },
    })

    const container = {
      // CloudKit identities use the transport schema, which has no `kind` field.
      setUpAuth: async () => ({ userRecordName: 1 }),
      whenUserSignsIn: () => {
        document.documentElement.setAttribute(
          'data-demo-cloudkit-sign-in-waiting',
          'true',
        )
        return new Promise<never>(() => {})
      },
    }
    Object.defineProperty(window, 'CloudKit', {
      configurable: true,
      value: {
        configure: () => {
          const control = document.createElement('button')
          control.type = 'button'
          control.className = 'apple-auth-button'
          control.style.width = '64px'
          control.style.height = '36px'
          control.addEventListener('click', () => {
            window.open(
              'https://idmsa.apple.com/appleauth/auth/signin',
              '_blank',
            )
          })
          document.getElementById('apple-sign-in-button')?.append(control)
        },
        getDefaultContainer: () => container,
      },
    })
  })

  await page.goto('https://localhost:5173/app/')
  await clearBrowserVault(page)
  await page.reload()
  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-icloud').click()
  await expect(page.getByTestId('icloud-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('icloud-origin-unsupported')).toHaveCount(0)

  const signInButton = page.locator('#apple-sign-in-button .apple-auth-button')
  await expect(signInButton).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await signInButton.click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-cloudkit-sign-in-waiting',
    'true',
  )

  await page.clock.fastForward(60_001)

  await expect(page.getByTestId('icloud-oauth-error')).toContainText(
    localeTimeoutCopy(await page.locator('html').getAttribute('lang')),
  )
  const openedUrls = openedUrlsFromDecode(
    Effect.runSync(
      decodeOpenedUrls(
        await page.locator('html').getAttribute('data-demo-opened-urls'),
      ),
    ),
  )
  expect(openedUrls).toHaveLength(1)
  const openedUrl = openedUrls.join('')
  expect(new URL(openedUrl).hostname).toBe('idmsa.apple.com')
  expect(page.context().pages()).toHaveLength(1)
})
