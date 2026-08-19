import { LegalRouteKind } from "$lib/app/route-state";

export const APP_VERSION = "0.1.0";
export const APP_SHELL_WIDTH = "max-w-5xl";
export const APP_SHELL_WIDTH_WIDE = "max-w-[90rem]";

type AppShellLayoutState = {
  legalRouteKind: LegalRouteKind;
  logsOpen: boolean;
  extensionConnectOpen: boolean;
  authenticated: boolean;
  editorOpen: boolean;
};

export function appShellSpacing(state: AppShellLayoutState): string {
  if (
    state.legalRouteKind === LegalRouteKind.Legal ||
    state.logsOpen ||
    state.extensionConnectOpen ||
    !state.authenticated
  ) {
    return "py-5 sm:py-6";
  }
  return state.editorOpen ? "py-4 sm:py-8" : "pb-28 pt-4 sm:py-8";
}
