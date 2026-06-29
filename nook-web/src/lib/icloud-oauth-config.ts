/**
 * Nook iCloud CloudKit — browser-only web auth (CloudKit JS).
 *
 * Apple Developer → CloudKit Dashboard → Production environment:
 * - Container: iCloud.metasecret.project.com
 * - API token (Tokens & Keys) with private-database access
 * - Allowed origins: https://nokey.sh
 * - Deploy schema (NookVault + content) to Production
 * - Sign in with Apple via CloudKit JS setUpAuth (Post Message callback)
 */
export const ICLOUD_CONTAINER_ID = 'iCloud.metasecret.project.com'
export const ICLOUD_API_TOKEN =
  '3cb4e4323cddc52e7e91af453b3d4f80d90c12fa395647b1b47b3cd72b66bf5b'
export const ICLOUD_ENVIRONMENT: 'development' | 'production' = 'production'

/** Web auth token used with the in-memory CloudKit REST stub in Playwright e2e. */
export const ICLOUD_E2E_STUB_WEB_AUTH_TOKEN = 'ck-web-auth-e2e-stub-token'

export function isICloudE2eStubMode(): boolean {
  return ICLOUD_API_TOKEN.trim() === 'e2e-stub-token'
}
