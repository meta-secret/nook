import type { VaultState } from '$lib/vault.svelte'
import { DEFAULT_DRIVE_VAULT_FILE } from '$lib/auth-providers'
import {
  ensureValidOAuthFileConfig,
  fetchGoogleAccountEmail,
  initGoogleAuth,
  isGoogleOAuthConfigured,
  oauthTokensToConfig,
  requestGoogleAccessToken,
  type GoogleOAuthTokens,
} from '$lib/google-oauth'
import {
  ensureValidICloudOAuthFileConfig,
  fetchICloudAccountEmail,
  initICloudAuth,
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
  requestICloudWebAuthToken,
  type ICloudOAuthTokens,
} from '$lib/icloud-oauth'

export async function ensureOAuthTokensFresh(state: VaultState): Promise<void> {
  if (state.storageMode !== 'oauth-file' || !state.oauthFile) {
    return
  }
  const refreshed =
    state.oauthFile.preset === 'icloud'
      ? await ensureValidICloudOAuthFileConfig(state.oauthFile)
      : await ensureValidOAuthFileConfig(state.oauthFile)
  if (
    refreshed.accessToken === state.oauthFile.accessToken &&
    refreshed.expiresAt === state.oauthFile.expiresAt
  ) {
    return
  }
  state.oauthFile = refreshed
  if (state.oauthFile && state.providers.some((p) => p.type === 'oauth-file')) {
    state.providers = state.providers.map((provider) =>
      provider.type === 'oauth-file' &&
      provider.oauthFile?.preset === refreshed.preset
        ? { ...provider, oauthFile: refreshed }
        : provider,
    )
    await state.persistProviders()
  }
}

export async function signInWithGoogle(state: VaultState): Promise<void> {
  if (!isGoogleOAuthConfigured()) {
    state.errorMsg = state.t('provider_setup.google_oauth_unconfigured')
    return
  }
  state.googleOAuthBusy = true
  state.errorMsg = ''
  try {
    await initGoogleAuth()
    const tokens = await requestGoogleAccessToken({ prompt: 'consent' })
    await applyGoogleOAuthTokens(state, tokens)
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : 'Google sign-in failed.'
  } finally {
    state.googleOAuthBusy = false
  }
}

export async function signInWithICloud(state: VaultState): Promise<void> {
  if (!isICloudOAuthConfigured()) {
    state.errorMsg = state.t('provider_setup.icloud_oauth_unconfigured')
    return
  }
  state.icloudOAuthBusy = true
  state.errorMsg = ''
  try {
    await initICloudAuth()
    const tokens = await requestICloudWebAuthToken()
    await applyICloudOAuthTokens(state, tokens)
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : 'iCloud sign-in failed.'
  } finally {
    state.icloudOAuthBusy = false
  }
}

async function applyICloudOAuthTokens(
  state: VaultState,
  tokens: ICloudOAuthTokens,
): Promise<void> {
  const account = await fetchICloudAccountEmail()
  state.loginSetupType = 'oauth-file'
  if (!state.addProviderOpen) {
    state.storageMode = 'oauth-file'
  }
  state.oauthSetupPreset = 'icloud'
  state.oauthFile = oauthTokensToICloudConfig(tokens, {
    preset: 'icloud',
    accessToken: tokens.accessToken,
    fileId: state.oauthFile?.fileId,
    fileName:
      state.oauthFile?.fileName?.trim() ||
      state.githubRepo.trim() ||
      DEFAULT_DRIVE_VAULT_FILE,
    accountEmail: account,
  })
  state.githubPat = ''
  state.githubRepo =
    state.oauthFile.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
}

async function applyGoogleOAuthTokens(
  state: VaultState,
  tokens: GoogleOAuthTokens,
): Promise<void> {
  const email = await fetchGoogleAccountEmail(tokens.accessToken)
  state.loginSetupType = 'oauth-file'
  if (!state.addProviderOpen) {
    state.storageMode = 'oauth-file'
  }
  state.oauthSetupPreset = 'google-drive'
  state.oauthFile = oauthTokensToConfig(tokens, {
    preset: 'google-drive',
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    fileId: state.oauthFile?.fileId,
    fileName:
      state.oauthFile?.fileName?.trim() ||
      state.githubRepo.trim() ||
      DEFAULT_DRIVE_VAULT_FILE,
    accountEmail: email,
  })
  state.githubPat = ''
  state.githubRepo =
    state.oauthFile.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
}
