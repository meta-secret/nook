/**
 * Nook Google Drive OAuth — Google Identity Services token client (browser-only).
 *
 * Same model as me-ai: public Web client id only, no client secret, no redirect
 * callback or backend token exchange.
 *
 * Google Cloud Console → Credentials → OAuth client (Web application):
 * - Authorized JavaScript origins: https://localhost:5173,
 *   https://localhost:5175, http://localhost:5173, https://nokey.sh,
 *   https://simple.nokey.sh, https://sentinel.nokey.sh,
 *   https://simple.dev.nokey.sh, https://sentinel.dev.nokey.sh
 * - OAuth consent screen scopes:
 *   - Private provider mode: https://www.googleapis.com/auth/drive.appdata
 *   - Shared provider mode: https://www.googleapis.com/auth/drive.file
 *   - Shared cross-account reads: https://www.googleapis.com/auth/drive.readonly
 *
 * Redirect URIs are not used by the GIS token client flow.
 */
export const GOOGLE_OAUTH_CLIENT_ID =
  "327685619872-tspdfe15hcerk2cfb6k0qk8kidiu9bn9.apps.googleusercontent.com";
