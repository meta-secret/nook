import {
  ExtensionConnectIntentKind,
  LegalRouteKind,
  extensionConnectIntent,
  legalRoute,
  type ExtensionConnectIntent,
  type LegalRoute,
} from "$lib/app-lifecycle-state";
import { extensionConnectRequestFromLocation } from "$lib/extension-connect";
import { getLegalPageFromPath } from "$lib/legal-content";

export function initialLegalRoute(): LegalRoute {
  return "window" in globalThis
    ? legalRoute(getLegalPageFromPath(window.location.pathname))
    : { kind: LegalRouteKind.Application };
}

export function initialExtensionConnectIntent(
  supportsExtension: boolean,
): ExtensionConnectIntent {
  return "window" in globalThis && supportsExtension
    ? extensionConnectIntent(
        extensionConnectRequestFromLocation(window.location),
      )
    : { kind: ExtensionConnectIntentKind.Absent };
}
