import { I18N_KEYS } from "../../nook-web-shared/src/generated/i18n-keys";
import type {
  ExtensionConnectFollow,
  ExtensionConnectStep,
} from "$web-shared/extension/extension-connect-progress";

export type ExtensionConnectProgressBegin = {
  readonly extensionRuntimeId: string;
  readonly follow: ExtensionConnectFollow;
};

/**
 * Sentinel's fail-closed facade for the connect page's port: the extension
 * is a Simple Vault capability, Sentinel denies the connect route, and no
 * port to the extension is ever opened from this bundle.
 */
class SentinelExtensionConnectProgress {
  begin(request: ExtensionConnectProgressBegin): void {
    void request;
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  }

  report(step: ExtensionConnectStep): void {
    void step;
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  }

  /** Leaving a route never opened a port here. */
  end(): void {}
}

export const extensionConnectProgress = new SentinelExtensionConnectProgress();
