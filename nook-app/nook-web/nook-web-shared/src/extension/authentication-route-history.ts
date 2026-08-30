export const AUTHENTICATION_ROUTE_HISTORY_SOURCE =
  "nook-authentication-route-v1";

export function notifyAuthenticationRouteChanged(): void {
  const message: Parameters<typeof window.postMessage>[0] = {
    source: AUTHENTICATION_ROUTE_HISTORY_SOURCE,
  };
  window.postMessage(message, location.origin);
}

export function isAuthenticationRouteHistoryMessage(
  event: MessageEvent,
): boolean {
  if (event.origin !== location.origin || event.source !== window) {
    return false;
  }
  const data = event.data;
  return (
    typeof data === "object" &&
    Boolean(data) &&
    data.source === AUTHENTICATION_ROUTE_HISTORY_SOURCE
  );
}

export function observeAuthenticationRouteHistory(
  onNavigate: () => void,
): () => void {
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState = function (data, unused, url) {
    pushState(data, unused, url);
    onNavigate();
  };
  history.replaceState = function (data, unused, url) {
    replaceState(data, unused, url);
    onNavigate();
  };
  window.addEventListener("popstate", onNavigate);
  return () => {
    history.pushState = pushState;
    history.replaceState = replaceState;
    window.removeEventListener("popstate", onNavigate);
  };
}
