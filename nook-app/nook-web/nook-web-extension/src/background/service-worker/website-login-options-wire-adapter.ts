import {
  decode_website_login_match_availability,
  unavailable_website_login_match_availability,
  type WebsiteLoginMatchAvailability,
  type WebsiteLoginOptionsAdmission,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Owns admission of the Rust/WASM website-login options wire projection. */
class WebsiteLoginOptionsWireAdapter {
  decode(value: WebsiteLoginOptionsAdmission): WebsiteLoginMatchAvailability {
    try {
      return decode_website_login_match_availability(value)
    } catch {
      return unavailable_website_login_match_availability()
    }
  }
}

export const websiteLoginOptionsWireAdapter =
  new WebsiteLoginOptionsWireAdapter()
