const SENTINEL_ONBOARDING_HASH_PREFIX = "#sentinel-onboard=";

export function consumeSentinelOnboardingFromLocation(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  if (!url.hash.startsWith(SENTINEL_ONBOARDING_HASH_PREFIX)) return "";
  const encoded = url.hash.slice(SENTINEL_ONBOARDING_HASH_PREFIX.length);
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return "";
    url.hash = "";
    history.replaceState({}, "", `${url.pathname}${url.search}`);
    return encoded;
  } catch {
    return "";
  }
}
