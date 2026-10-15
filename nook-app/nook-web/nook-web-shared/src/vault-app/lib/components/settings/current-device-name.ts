import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";

type CurrentDeviceNameRequest = {
  readonly t: VaultState["t"];
};

/** This browser's name in the device list, read from its user agent:
 * "Chrome on Mac". */
export class CurrentDeviceName {
  constructor(private readonly request: CurrentDeviceNameRequest) {}

  get text(): string {
    const { t } = this.request;
    if (!("navigator" in globalThis))
      return t(I18N_KEYS.DevicesCardThisBrowserOs);
    const ua = navigator.userAgent;
    let os = t(I18N_KEYS.DevicesCardUnknownOs);
    if (ua.includes("Android")) os = "Android";
    else if (ua.includes("like Mac")) os = "iOS";
    else if (ua.includes("Win")) os = "Windows";
    else if (ua.includes("Mac")) os = "Mac";
    else if (ua.includes("Linux")) os = "Linux";

    let browser = "Browser";
    if (ua.includes("Edg")) browser = "Edge";
    else if (ua.includes("Firefox")) browser = "Firefox";
    else if (ua.includes("Chrome")) browser = "Chrome";
    else if (ua.includes("Safari")) browser = "Safari";
    return `${browser} ${t(I18N_KEYS.DevicesCardOn)} ${os}`;
  }
}
