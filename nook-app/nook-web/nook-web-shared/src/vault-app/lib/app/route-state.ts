import {
  ExtensionConnectRequestStateKind,
  type ExtensionConnectRequest,
  type ExtensionConnectRequestState,
  extensionConnectionBrowser,
} from "$lib/extension/connect";
import {
  ApplicationRoutePresentation,
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

export class LegalRouteProjection {
  constructor(private readonly request: LegalPageLookup) {}
  get route(): LegalRoute {
    const page = this.request;

    return page.kind === LegalPageLookupKind.LegalPage
      ? { kind: LegalRouteKind.Legal, page: page.page }
      : { kind: LegalRouteKind.Application };
  }
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

export class ExtensionConnectionIntentProjection {
  constructor(private readonly request: ExtensionConnectRequestState) {}
  get intent(): ExtensionConnectIntent {
    const state = this.request;

    return state.kind === ExtensionConnectRequestStateKind.Requested
      ? { kind: ExtensionConnectIntentKind.Requested, request: state.request }
      : { kind: ExtensionConnectIntentKind.Absent };
  }
}

export function initialLegalRoute(): LegalRoute {
  return "window" in globalThis
    ? new LegalRouteProjection(
        new ApplicationRoutePresentation(
          window.location.pathname,
        ).getLegalPageFromPath(),
      ).route
    : { kind: LegalRouteKind.Application };
}

export function initialExtensionConnectIntent(
  supportsExtension: boolean,
): ExtensionConnectIntent {
  return "window" in globalThis && supportsExtension
    ? new ExtensionConnectionIntentProjection(
        extensionConnectionBrowser.extensionConnectRequestFromLocation(
          window.location,
        ),
      ).intent
    : { kind: ExtensionConnectIntentKind.Absent };
}
