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
