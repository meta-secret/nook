import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  decode_website_login_match_availability,
  type WebsiteLoginMatchAvailability,
  type WebsiteLoginOptionsWireValue,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { WebsiteAuthenticatorResponseStatus } from '../../lib/login-fill-messages'
import {
  LoginMatchAvailabilityCache,
  type LoginMatchAvailabilityCacheInvalidation,
  type LoginMatchAvailabilityCacheOptions,
  type LoginMatchAvailabilityCacheRequest,
} from '../../lib/login-match-availability-cache'
import { extensionSessionProbeDeadline } from '../../offscreen/session-request-adapter'
import {
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
} from './account-picker-authorization'
import {
  loginAccountAvailabilityForOrigin,
  loginAccountsForOrigin,
  type LoginAccountAvailabilityForOriginArgs,
} from './account-pickers'
import {
  availableWebsiteGrants,
  passiveAvailableWebsiteGrants,
} from './pairing-identity'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  openCompanionLauncherBestEffort,
} from './session-lifecycle'
type WebsiteLoginOptionsArgs = {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
  dependencies?: WebsiteLoginOptionsDependencies
}
type WebsiteLoginOptionsResponseArgs = WebsiteLoginOptionsArgs & {
  openUnavailableCompanion: boolean
}
type WebsiteLoginOptionsResponse =
  | WebsiteLoginOptionsWireValue
  | (WebsiteLoginOptionsWireValue & { authorizationGeneration: string })
type WebsiteLoginOptionsDependencies = {
  accountPickerAuthorizationCleanupPending: typeof accountPickerAuthorizationCleanupPending
  accountPickerAuthorizationGeneration: typeof accountPickerAuthorizationGeneration
  accountPickerAuthorizationIsCurrent: typeof accountPickerAuthorizationIsCurrent
  availableWebsiteGrants: typeof availableWebsiteGrants
  passiveAvailableWebsiteGrants: typeof passiveAvailableWebsiteGrants
  loginAccountsForOrigin: typeof loginAccountsForOrigin
  loginAccountAvailabilityForOrigin: typeof loginAccountAvailabilityForOrigin
  openCompanionLauncherBestEffort: typeof openCompanionLauncherBestEffort
}
const dependencies: WebsiteLoginOptionsDependencies = {
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
  availableWebsiteGrants,
  passiveAvailableWebsiteGrants,
  loginAccountsForOrigin,
  loginAccountAvailabilityForOrigin,
  openCompanionLauncherBestEffort,
}
async function websiteLoginOptionsResponse({
  message,
  sender,
  dependencies: injected,
  openUnavailableCompanion,
}: WebsiteLoginOptionsResponseArgs): Promise<WebsiteLoginOptionsResponse> {
  const resolved = injected ?? dependencies
  const authorizationGeneration =
    await resolved.accountPickerAuthorizationGeneration()
  if (
    !resolved.accountPickerAuthorizationIsCurrent(authorizationGeneration) ||
    (await resolved.accountPickerAuthorizationCleanupPending())
  ) {
    return { ok: false, reason: 'login-options-unavailable' }
  }
  const accessRequest: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'login-forbidden-origin',
  }
  const access = await (
    openUnavailableCompanion
      ? resolved.availableWebsiteGrants
      : resolved.passiveAvailableWebsiteGrants
  )(accessRequest)
  if ('response' in access) {
    if (
      openUnavailableCompanion &&
      access.response.ok &&
      access.response.status === WebsiteAuthenticatorResponseStatus.Unavailable
    ) {
      resolved.openCompanionLauncherBestEffort(OpenCompanionLauncherIntent.Pair)
    }
    return access.response as WebsiteLoginOptionsWireValue
  }
  let accounts
  if (openUnavailableCompanion) {
    const accountRequest: Parameters<typeof loginAccountsForOrigin>[0] = {
      grants: access.grants,
      origin: message.payload.origin,
    }
    accounts = await resolved.loginAccountsForOrigin(accountRequest)
  } else {
    const request: LoginAccountAvailabilityForOriginArgs = {
      grants: access.grants,
      origin: message.payload.origin,
      queue: extensionSessionProbeDeadline(
        Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
      ),
    }
    const availability =
      await resolved.loginAccountAvailabilityForOrigin(request)
    if (!availability.ok) {
      return { ok: false, reason: 'login-options-unavailable' }
    }
    accounts = availability.accounts
  }
  if (
    !resolved.accountPickerAuthorizationIsCurrent(authorizationGeneration) ||
    (await resolved.accountPickerAuthorizationCleanupPending())
  ) {
    return { ok: false, reason: 'login-options-unavailable' }
  }
  return { ok: true, status: 'ready', authorizationGeneration, accounts }
}
export async function websiteLoginOptions(
  args: WebsiteLoginOptionsArgs,
): Promise<WebsiteLoginOptionsResponse> {
  const request: WebsiteLoginOptionsResponseArgs = {
    ...args,
    openUnavailableCompanion: true,
  }
  return websiteLoginOptionsResponse(request)
}
const cacheOptions: LoginMatchAvailabilityCacheOptions = { ttlMs: 2_000 }
const cache = new LoginMatchAvailabilityCache(cacheOptions)
export function invalidateLoginMatchAvailabilityForOrigin(
  invalidation: LoginMatchAvailabilityCacheInvalidation,
): void {
  cache.invalidate(invalidation)
}
export function invalidateAllLoginMatchAvailability(): void {
  cache.invalidateAll()
}
type WebsiteLoginMatchAvailabilityArgs = {
  origin: string
  sender: chrome.runtime.MessageSender
  dependencies?: WebsiteLoginOptionsDependencies
}
export function websiteLoginMatchAvailability({
  origin,
  sender,
  dependencies: injected,
}: WebsiteLoginMatchAvailabilityArgs): Promise<WebsiteLoginMatchAvailability> {
  const request: LoginMatchAvailabilityCacheRequest = {
    origin,
    load: async () => {
      const message: WebsiteLoginOptionsArgs['message'] = {
        payload: { origin },
      }
      const responseRequest: WebsiteLoginOptionsResponseArgs = {
        message,
        sender,
        dependencies: injected,
        openUnavailableCompanion: false,
      }
      const response = await websiteLoginOptionsResponse(responseRequest)
      return decode_website_login_match_availability(
        response as WebsiteLoginOptionsWireValue,
      )
    },
  }
  return cache.resolve(request)
}
