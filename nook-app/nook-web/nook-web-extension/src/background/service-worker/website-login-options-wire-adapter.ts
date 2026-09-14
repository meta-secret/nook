import {
  decode_website_login_match_availability,
  unavailable_website_login_match_availability,
  type WebsiteLoginMatchAvailability,
  type WebsiteLoginOptionsWireValue,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type WebsiteLoginOptionsTransportValue =
  | WebsiteLoginWireObject
  | WebsiteLoginWireObject[]
  | string
  | boolean

type WebsiteLoginWireObject = {
  [key: string]:
    string | boolean | WebsiteLoginWireObject | WebsiteLoginWireObject[]
}

/** Owns admission of the Rust/WASM website-login options wire projection. */
class WebsiteLoginOptionsWireAdapter {
  decode(
    value: WebsiteLoginOptionsTransportValue,
  ): WebsiteLoginMatchAvailability {
    if (!this.isOptions(value)) {
      return unavailable_website_login_match_availability()
    }
    return decode_website_login_match_availability(value)
  }

  private isOptions(
    value: WebsiteLoginOptionsTransportValue,
  ): value is WebsiteLoginOptionsWireValue {
    if (!this.isObject(value)) return false
    if (typeof value.ok !== 'boolean') return false
    if (!value.ok) return typeof value.reason === 'string'
    if (typeof value.status !== 'string') return false
    if (value.status !== 'ready') {
      return value.status === 'locked' || value.status === 'unavailable'
    }
    if (
      typeof value.authorizationGeneration !== 'string' ||
      !Array.isArray(value.accounts)
    ) {
      return false
    }
    return value.accounts.every((account) => this.isAccount(account))
  }

  private isObject(
    value: WebsiteLoginOptionsTransportValue,
  ): value is WebsiteLoginWireObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  private isAccount(value: WebsiteLoginOptionsTransportValue): boolean {
    if (!this.isObject(value)) return false
    return (
      typeof value.vaultStoreId === 'string' &&
      typeof value.vaultName === 'string' &&
      typeof value.secretId === 'string' &&
      typeof value.username === 'string' &&
      typeof value.websiteUrl === 'string' &&
      typeof value.websiteHost === 'string'
    )
  }
}

export const websiteLoginOptionsWireAdapter =
  new WebsiteLoginOptionsWireAdapter()
