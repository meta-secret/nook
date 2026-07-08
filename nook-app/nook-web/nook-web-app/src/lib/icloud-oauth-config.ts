/**
 * Nook iCloud CloudKit — browser-only web auth (CloudKit JS).
 *
 * CloudKit Console → Production → iCloud.metasecret.project.com:
 * - API token (Settings -> Tokens & Keys), allowed origins https://nokey.sh and https://nokey-sh.pages.dev
 * - Schema: NookVault record type with content (String), deployed to Production
 * - Sign in with Apple via CloudKit JS setUpAuth (Post Message callback)
 */
export const ICLOUD_CONTAINER_ID = 'iCloud.metasecret.project.com'
export const ICLOUD_API_TOKEN =
  'c31649c685f5f589c1c66f867ab2c013b6765d01e6bda454ec28d246ca4dc7d0'
export const ICLOUD_ENVIRONMENT = 'production' as const
