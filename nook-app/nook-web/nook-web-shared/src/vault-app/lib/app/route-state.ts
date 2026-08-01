import {
  extensionConnectRequestFromLocation,
  ExtensionConnectRequestStateKind,
  type ExtensionConnectRequest,
  type ExtensionConnectRequestState,
} from "$lib/extension/connect";
import {
  getLegalPageFromPath,
  LegalPageLookupKind,
  type LegalPageId,
  type LegalPageLookup,
} from "$lib/content/legal";

export enum LegalRouteKind {
  Application = "application",
  Legal = "legal",
}

export type LegalRoute =
  | { kind: LegalRouteKind.Application }
  | { kind: LegalRouteKind.Legal; page: LegalPageId };

export function legalRoute(page: LegalPageLookup): LegalRoute {
  return page.kind === LegalPageLookupKind.LegalPage
    ? { kind: LegalRouteKind.Legal, page: page.page }
    : { kind: LegalRouteKind.Application };
}

export enum ExtensionConnectIntentKind {
  Absent = "absent",
  Requested = "requested",
}

export type ExtensionConnectIntent =
  | { kind: ExtensionConnectIntentKind.Absent }
  | {
      kind: ExtensionConnectIntentKind.Requested;
      request: ExtensionConnectRequest;
    };

export function extensionConnectIntent(
  state: ExtensionConnectRequestState,
): ExtensionConnectIntent {
  return state.kind === ExtensionConnectRequestStateKind.Requested
    ? { kind: ExtensionConnectIntentKind.Requested, request: state.request }
    : { kind: ExtensionConnectIntentKind.Absent };
}

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
