import type { Page } from '@playwright/test'

/** The Google account every e2e Drive stub and OAuth mock signs in as unless
 * a test names another one. A device invite names this account when the
 * owner picks itself, so a joining page must report the same email. */
export const E2E_GOOGLE_ACCOUNT_EMAIL = 'e2e-user@example.com'

function installGoogleTokenClient(token: string) {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          callback: (response: {
            access_token: string
            expires_in: number
          }) => void
        }) => ({
          requestAccessToken: () => {
            config.callback({ access_token: token, expires_in: 3600 })
          },
        }),
      },
    },
  }
}

/** Mock the Google Identity Services token client so every sign-in on this
 * page returns `accessToken`. Call before navigation. */
export async function installGoogleIdentityTokenMock(
  page: Page,
  accessToken: string,
) {
  const gisMockBody = `window.google=window.google||{};window.google.accounts=window.google.accounts||{};window.google.accounts.oauth2={initTokenClient:function(config){return{requestAccessToken:function(){config.callback({access_token:${JSON.stringify(accessToken)},expires_in:3600})}}}};`

  await page.addInitScript(installGoogleTokenClient, accessToken)
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: gisMockBody,
    })
  })
  await page.evaluate(installGoogleTokenClient, accessToken)
}
