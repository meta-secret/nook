/**
 * Nook Google Drive OAuth — Google Identity Services token client (browser-only).
 *
 * Same model as me-ai: public Web client id only, no client secret, no redirect
 * callback or backend token exchange.
 *
 * Google Cloud Console → Credentials → OAuth client (Web application):
 * - Authorized JavaScript origins: http://localhost:5173, https://nokey.sh
 * - OAuth consent screen scope: https://www.googleapis.com/auth/drive.appdata
 *
 * Redirect URIs are not used by the GIS token client flow.
 */
export const GOOGLE_OAUTH_CLIENT_ID =
  '327685619872-tspdfe15hcerk2cfb6k0qk8kidiu9bn9.apps.googleusercontent.com'
