export const AUTHENTICATION_ROUTE_HISTORY_SOURCE =
  "nook-authentication-route-v1";

type NavigationCurrentEntryChangeListener = () => void;

type SameDocumentNavigationObserver = {
  addEventListener(
    type: "currententrychange",
    listener: NavigationCurrentEntryChangeListener,
  ): void;
  removeEventListener(
    type: "currententrychange",
    listener: NavigationCurrentEntryChangeListener,
  ): void;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class AuthenticationRouteBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  notifyAuthenticationRouteChanged(): void {
    const targetOrigin = this.browser.location.origin;
    if (targetOrigin === "null") return;
    const message: Parameters<typeof this.browser.window.postMessage>[0] = {
      source: AUTHENTICATION_ROUTE_HISTORY_SOURCE,
    };
    this.browser.window.postMessage(message, targetOrigin);
  }

  isAuthenticationRouteHistoryMessage(event: MessageEvent): boolean {
    if (
      this.browser.location.origin === "null" ||
      event.origin === "null" ||
      event.origin !== this.browser.location.origin ||
      event.source !== this.browser.window
    ) {
      return false;
    }
    const data = event.data;
    return (
      typeof data === "object" &&
      Boolean(data) &&
      data.source === AUTHENTICATION_ROUTE_HISTORY_SOURCE
    );
  }

  private sameDocumentNavigationObserver():
    SameDocumentNavigationObserver | false {
    const navigation = Reflect.get(this.browser.window, "navigation");
    if (
      typeof navigation !== "object" ||
      !navigation ||
      typeof Reflect.get(navigation, "addEventListener") !== "function" ||
      typeof Reflect.get(navigation, "removeEventListener") !== "function"
    ) {
      return false;
    }
    return navigation as SameDocumentNavigationObserver;
  }

  private observeSameDocumentNavigation(
    onNavigate: NavigationCurrentEntryChangeListener,
  ): () => void {
    const navigation = this.sameDocumentNavigationObserver();
    if (!navigation) return () => {};
    navigation.addEventListener("currententrychange", onNavigate);
    return () => {
      navigation.removeEventListener("currententrychange", onNavigate);
    };
  }

  observeAuthenticationRouteHistory(onNavigate: () => void): () => void {
    const pushState = this.browser.history.pushState.bind(this.browser.history);
    const replaceState = this.browser.history.replaceState.bind(
      this.browser.history,
    );
    this.browser.history.pushState = function (...args) {
      pushState(...args);
      onNavigate();
    };
    this.browser.history.replaceState = function (...args) {
      replaceState(...args);
      onNavigate();
    };
    this.browser.window.addEventListener("popstate", onNavigate);
    this.browser.window.addEventListener("hashchange", onNavigate);
    const stopNavigation = this.observeSameDocumentNavigation(onNavigate);
    return () => {
      this.browser.history.pushState = pushState;
      this.browser.history.replaceState = replaceState;
      this.browser.window.removeEventListener("popstate", onNavigate);
      this.browser.window.removeEventListener("hashchange", onNavigate);
      stopNavigation();
    };
  }
}

export const authenticationRouteBrowser = new AuthenticationRouteBrowser(
  globalThis,
);
