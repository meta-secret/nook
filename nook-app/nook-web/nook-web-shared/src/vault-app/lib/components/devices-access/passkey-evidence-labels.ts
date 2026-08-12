type PasskeyAttachmentLabelRequest = {
  readonly vault: VaultState;
  readonly value: NookPasskeyAttachmentState;
};

type PasskeyBackupLabelRequest = {
  readonly vault: VaultState;
  readonly value: NookPasskeyBackupState;
};

type PasskeyTransportLabelRequest = {
  readonly vault: VaultState;
  readonly value: PasskeyTransport;
};

type PasskeyTransportsLabelRequest = {
  readonly vault: VaultState;
  readonly values: readonly PasskeyTransport[];
};

type PasskeyBrowserLabelRequest = {
  readonly vault: VaultState;
  readonly value: PasskeyObservedBrowser;
};

type PasskeyPlatformLabelRequest = {
  readonly vault: VaultState;
  readonly value: PasskeyObservedPlatform;
};

type PasskeyClientEnvironmentLabelRequest = {
  readonly vault: VaultState;
  readonly browser: PasskeyObservedBrowser;
  readonly platform: PasskeyObservedPlatform;
};

import { I18N_KEYS } from "../../../../generated/i18n-keys";
import {
  NookPasskeyAttachmentState,
  NookPasskeyBackupState,
  PasskeyObservedBrowser,
  PasskeyObservedPlatform,
  PasskeyTransport,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";

/**
 * Plain-language names for the WebAuthn facts a browser reported during a
 * ceremony. Every unsupported or unreported value stays explicitly unknown.
 */
export function attachmentLabel({
  vault,
  value,
}: PasskeyAttachmentLabelRequest): string {
  if (value === NookPasskeyAttachmentState.Platform) {
    return vault.t(I18N_KEYS.DevicesAccessAttachmentPlatform);
  }
  return value === NookPasskeyAttachmentState.CrossPlatform
    ? vault.t(I18N_KEYS.DevicesAccessAttachmentCrossPlatform)
    : vault.t(I18N_KEYS.DevicesAccessUnknown);
}

export function backupLabel({
  vault,
  value,
}: PasskeyBackupLabelRequest): string {
  if (value === NookPasskeyBackupState.BackedUp) {
    return vault.t(I18N_KEYS.DevicesAccessBackupBackedUp);
  }
  if (value === NookPasskeyBackupState.Eligible) {
    return vault.t(I18N_KEYS.DevicesAccessBackupEligible);
  }
  return value === NookPasskeyBackupState.NotEligible
    ? vault.t(I18N_KEYS.DevicesAccessBackupNotEligible)
    : vault.t(I18N_KEYS.DevicesAccessUnknown);
}

function transportLabel({
  vault,
  value,
}: PasskeyTransportLabelRequest): string {
  if (value === PasskeyTransport.Ble) {
    return vault.t(I18N_KEYS.DevicesAccessTransportBle);
  }
  if (value === PasskeyTransport.Hybrid) {
    return vault.t(I18N_KEYS.DevicesAccessTransportHybrid);
  }
  if (value === PasskeyTransport.Internal) {
    return vault.t(I18N_KEYS.DevicesAccessTransportInternal);
  }
  return value === PasskeyTransport.Nfc
    ? vault.t(I18N_KEYS.DevicesAccessTransportNfc)
    : vault.t(I18N_KEYS.DevicesAccessTransportUsb);
}

export function transportsLabel({
  vault,
  values,
}: PasskeyTransportsLabelRequest): string {
  if (values.length === 0) return vault.t(I18N_KEYS.DevicesAccessUnknown);
  const ListFormatArgs: ConstructorParameters<typeof Intl.ListFormat>[1] = {
    style: "long",
    type: "conjunction",
  };
  return new Intl.ListFormat(vault.locale, ListFormatArgs).format(
    values.map((value) =>
      (() => {
        const transportLabelArgs: Parameters<typeof transportLabel>[0] = {
          vault,
          value,
        };
        return transportLabel(transportLabelArgs);
      })(),
    ),
  );
}

function browserLabel({ vault, value }: PasskeyBrowserLabelRequest): string {
  if (value === PasskeyObservedBrowser.Edge) {
    return vault.t(I18N_KEYS.DevicesAccessBrowserEdge);
  }
  if (value === PasskeyObservedBrowser.Firefox) {
    return vault.t(I18N_KEYS.DevicesAccessBrowserFirefox);
  }
  if (value === PasskeyObservedBrowser.Chrome) {
    return vault.t(I18N_KEYS.DevicesAccessBrowserChrome);
  }
  if (value === PasskeyObservedBrowser.Safari) {
    return vault.t(I18N_KEYS.DevicesAccessBrowserSafari);
  }
  return value === PasskeyObservedBrowser.Other
    ? vault.t(I18N_KEYS.DevicesAccessBrowserOther)
    : vault.t(I18N_KEYS.DevicesAccessUnknown);
}

function platformLabel({ vault, value }: PasskeyPlatformLabelRequest): string {
  if (value === PasskeyObservedPlatform.Android) {
    return vault.t(I18N_KEYS.DevicesAccessPlatformAndroid);
  }
  if (value === PasskeyObservedPlatform.AppleMobile) {
    return vault.t(I18N_KEYS.DevicesAccessPlatformAppleMobile);
  }
  if (value === PasskeyObservedPlatform.MacOs) {
    return vault.t(I18N_KEYS.DevicesAccessPlatformMacos);
  }
  if (value === PasskeyObservedPlatform.Windows) {
    return vault.t(I18N_KEYS.DevicesAccessPlatformWindows);
  }
  if (value === PasskeyObservedPlatform.Linux) {
    return vault.t(I18N_KEYS.DevicesAccessPlatformLinux);
  }
  return value === PasskeyObservedPlatform.Other
    ? vault.t(I18N_KEYS.DevicesAccessPlatformOther)
    : vault.t(I18N_KEYS.DevicesAccessUnknown);
}

export function clientEnvironmentLabel({
  vault,
  browser,
  platform,
}: PasskeyClientEnvironmentLabelRequest): string {
  if (
    browser === PasskeyObservedBrowser.Unknown &&
    platform === PasskeyObservedPlatform.Unknown
  ) {
    return vault.t(I18N_KEYS.DevicesAccessUnknown);
  }
  const translationRequest: Parameters<typeof vault.t>[0] = {
    key: I18N_KEYS.DevicesAccessClientDescription,
    replacements: {
      browser: (() => {
        const browserLabelArgs: Parameters<typeof browserLabel>[0] = {
          vault,
          value: browser,
        };
        return browserLabel(browserLabelArgs);
      })(),
      platform: (() => {
        const platformLabelArgs: Parameters<typeof platformLabel>[0] = {
          vault,
          value: platform,
        };
        return platformLabel(platformLabelArgs);
      })(),
    },
  };
  return vault.t(translationRequest);
}
