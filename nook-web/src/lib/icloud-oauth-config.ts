/**
 * Nook iCloud CloudKit — browser-only web auth (CloudKit JS).
 *
 * Apple Developer → CloudKit Dashboard → enable Web Services for the container:
 * - Container: iCloud.dev.nook (development) / production container when shipped
 * - API token with private-database access
 * - Sign in with Apple ID via CloudKit JS setUpAuth
 */
export const ICLOUD_CONTAINER_ID = 'iCloud.dev.nook'
export const ICLOUD_API_TOKEN = 'e2e-stub-token'
export const ICLOUD_ENVIRONMENT: 'development' | 'production' = 'development'

/** Web auth token used with the in-memory CloudKit REST stub in Playwright e2e. */
export const ICLOUD_E2E_STUB_WEB_AUTH_TOKEN = 'ck-web-auth-e2e-stub-token'

export function isICloudE2eStubMode(): boolean {
  return ICLOUD_API_TOKEN.trim() === 'e2e-stub-token'
}
