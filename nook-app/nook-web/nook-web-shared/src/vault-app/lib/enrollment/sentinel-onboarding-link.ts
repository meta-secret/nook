const SENTINEL_ONBOARDING_HASH_PREFIX = "#sentinel-onboard=";

/** Owns enrollment URL consumption and history cleanup for its browser host. */
class SentinelOnboardingBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  consumeSentinelOnboardingFromLocation(): string {
    if (!("window" in this.browser)) return "";
    const url = new URL(this.browser.window.location.href);
    if (!url.hash.startsWith(SENTINEL_ONBOARDING_HASH_PREFIX)) return "";
    const encoded = url.hash.slice(SENTINEL_ONBOARDING_HASH_PREFIX.length);
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return "";
      url.hash = "";
      const replaceStateArgs: Parameters<
        typeof this.browser.history.replaceState
      >[0] = {};
      this.browser.history.replaceState(
        replaceStateArgs,
        "",
        `${url.pathname}${url.search}`,
      );
      return encoded;
    } catch {
      return "";
    }
  }
}

export const sentinelOnboardingBrowser = new SentinelOnboardingBrowser(
  globalThis,
);
