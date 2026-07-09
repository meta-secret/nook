import type { VaultState } from '$lib/vault.svelte'
import { DEFAULT_DRIVE_BACKUP_NAME } from '$lib/auth-providers'
import {
  ensureValidOAuthFileConfig,
  fetchGoogleAccountEmail,
  initGoogleAuth,
  isGoogleOAuthConfigured,
  oauthTokensToConfig,
  requestGoogleAccessToken,
  requestGoogleDriveSharedAccess,
  type GoogleOAuthTokens,
} from '$lib/google-oauth'
import {
  ensureValidICloudOAuthFileConfig,
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
  prepareICloudSignInControl,
  requestPreparedICloudWebAuthToken,
  type ICloudOAuthTokens,
} from '$lib/icloud-oauth'
import {
  resolveOAuthOriginSupport,
  type BrowserOAuthProvider,
} from '$lib/oauth-origin'
import { createLogger } from '$lib/log'

const log = createLogger('vault-oauth')

export async function ensureOAuthTokensFresh(state: VaultState): Promise<void> {
  if (state.storageMode !== 'oauth-file' || !state.oauthFile) {
    return
  }
  log.info('oauth token freshness check started', {
    preset: state.oauthFile.preset,
    hasAccessToken: Boolean(state.oauthFile.accessToken?.trim()),
    expiresAt: state.oauthFile.expiresAt,
  })
  const refreshed =
    state.oauthFile.preset === 'icloud'
      ? await ensureValidICloudOAuthFileConfig(state.oauthFile)
      : await ensureValidOAuthFileConfig(state.oauthFile)
  if (
    refreshed.accessToken === state.oauthFile.accessToken &&
    refreshed.expiresAt === state.oauthFile.expiresAt
  ) {
    log.info('oauth token freshness check kept existing token', {
      preset: refreshed.preset,
      expiresAt: refreshed.expiresAt,
    })
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
  log.info('oauth token freshness check refreshed provider', {
    preset: refreshed.preset,
    expiresAt: refreshed.expiresAt,
    providerCount: state.providers.length,
  })
}

export async function signInWithGoogle(state: VaultState): Promise<void> {
  if (!isGoogleOAuthConfigured()) {
    state.errorMsg = state.t('provider_setup.google_oauth_unconfigured')
    return
  }
  if (!ensureSupportedOAuthOrigin(state, 'google-drive')) {
    return
  }
  state.googleOAuthBusy = true
  state.errorMsg = ''
  try {
    const shared = state.vaultArchitecture.replication_type === 'shared'
    const tokens = shared
      ? await requestGoogleDriveSharedAccess({ prompt: 'consent' })
      : await (async () => {
          await initGoogleAuth()
          return requestGoogleAccessToken({ prompt: 'consent' })
        })()
    await applyGoogleOAuthTokens(state, tokens)
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : 'Google sign-in failed.'
  } finally {
    state.googleOAuthBusy = false
  }
}

export async function signInWithICloud(
  state: VaultState,
  options: { clickPreparedControl?: boolean } = {},
): Promise<void> {
  log.info('iCloud sign-in requested', {
    configured: isICloudOAuthConfigured(),
    ready: state.icloudOAuthReady,
    preparing: state.icloudOAuthPreparing,
    busy: state.icloudOAuthBusy,
    clickPreparedControl: options.clickPreparedControl === true,
  })
  if (!isICloudOAuthConfigured()) {
    state.errorMsg = state.t('provider_setup.icloud_oauth_unconfigured')
    log.warn('iCloud sign-in blocked: not configured')
    return
  }
  if (!ensureSupportedOAuthOrigin(state, 'icloud')) {
    return
  }
  state.icloudOAuthBusy = true
  state.errorMsg = ''
  try {
    const wasReady = state.icloudOAuthReady
    if (!wasReady) {
      log.info('iCloud sign-in preparing control before token request')
      await prepareICloudSignIn(state)
    }
    if (!state.icloudOAuthReady) {
      log.warn('iCloud sign-in blocked: control not ready after prepare', {
        wasReady,
        ready: state.icloudOAuthReady,
        preparing: state.icloudOAuthPreparing,
      })
      throw new Error(
        'Apple sign-in control is still loading. Try again in a moment.',
      )
    }
    if (!wasReady) {
      log.info('iCloud sign-in control became ready; waiting for second click')
      throw new Error('Apple sign-in is ready. Click Sign in with Apple again.')
    }
    const tokenRequest = requestPreparedICloudWebAuthToken({
      clickSignInControl: options.clickPreparedControl,
    })
    const tokens = await tokenRequest
    log.info('iCloud sign-in returned token', {
      hasAccessToken: Boolean(tokens.accessToken.trim()),
      tokenLength: tokens.accessToken.length,
      hasAccountName: Boolean(tokens.accountName?.trim()),
    })
    await applyICloudOAuthTokens(state, tokens)
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : 'iCloud sign-in failed.'
    log.warn('iCloud sign-in failed', { error: state.errorMsg })
  } finally {
    state.icloudOAuthBusy = false
    log.info('iCloud sign-in finished', {
      ready: state.icloudOAuthReady,
      preparing: state.icloudOAuthPreparing,
      busy: state.icloudOAuthBusy,
      hasOauthFile: Boolean(state.oauthFile),
      oauthPreset: state.oauthFile?.preset,
      storageMode: state.storageMode,
    })
  }
}

export async function prepareICloudSignIn(state: VaultState): Promise<void> {
  log.info('iCloud sign-in prepare requested', {
    ready: state.icloudOAuthReady,
    preparing: state.icloudOAuthPreparing,
    configured: isICloudOAuthConfigured(),
  })
  if (
    state.icloudOAuthReady ||
    state.icloudOAuthPreparing ||
    !isICloudOAuthConfigured()
  ) {
    log.info('iCloud sign-in prepare skipped', {
      ready: state.icloudOAuthReady,
      preparing: state.icloudOAuthPreparing,
      configured: isICloudOAuthConfigured(),
    })
    return
  }
  const support = resolveOAuthOriginSupport('icloud')
  if (!support.supported) {
    log.warn('iCloud sign-in prepare blocked by origin', support)
    return
  }
  state.icloudOAuthPreparing = true
  try {
    await prepareICloudSignInControl()
    state.icloudOAuthReady = true
    log.info('iCloud sign-in prepare completed', {
      ready: state.icloudOAuthReady,
      origin: support.origin,
    })
  } catch (error) {
    state.icloudOAuthReady = false
    state.errorMsg =
      error instanceof Error ? error.message : 'iCloud sign-in failed.'
    log.warn('iCloud sign-in prepare failed', { error: state.errorMsg })
  } finally {
    state.icloudOAuthPreparing = false
  }
}

async function applyICloudOAuthTokens(
  state: VaultState,
  tokens: ICloudOAuthTokens,
): Promise<void> {
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
      DEFAULT_DRIVE_BACKUP_NAME,
    accountEmail: tokens.accountName,
  })
  state.githubPat = ''
  state.githubRepo =
    state.oauthFile.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
  log.info('iCloud oauth tokens applied to vault state', {
    storageMode: state.storageMode,
    oauthSetupPreset: state.oauthSetupPreset,
    hasOauthFile: Boolean(state.oauthFile),
    fileName: state.oauthFile.fileName,
    hasAccessToken: Boolean(state.oauthFile.accessToken?.trim()),
    tokenLength: state.oauthFile.accessToken?.length ?? 0,
  })
}

function ensureSupportedOAuthOrigin(
  state: VaultState,
  provider: BrowserOAuthProvider,
): boolean {
  const support = resolveOAuthOriginSupport(provider)
  if (support.supported) {
    log.info('oauth origin supported', {
      provider,
      origin: support.origin,
    })
    return true
  }
  log.warn('oauth origin unsupported', {
    provider,
    origin: support.origin,
    reason: support.reason,
  })
  state.errorMsg = state.t(
    support.reason === 'cloudflare-pr-preview'
      ? 'provider_setup.oauth_preview_origin_unsupported'
      : 'provider_setup.oauth_origin_unsupported',
    { origin: support.origin },
  )
  return false
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
      DEFAULT_DRIVE_BACKUP_NAME,
    accountEmail: email,
  })
  state.githubPat = ''
  state.githubRepo =
    state.oauthFile.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
}
