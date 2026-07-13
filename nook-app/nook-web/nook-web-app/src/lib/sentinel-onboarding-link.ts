import { getEnrollmentLinkBase } from '$lib/enrollment-code'

const SENTINEL_ONBOARDING_HASH_PREFIX = '#sentinel-onboard='

export function buildSentinelOnboardingLink(
  packageCode: string,
  baseUrl = getEnrollmentLinkBase(),
): string {
  const url = new URL(baseUrl)
  url.hash = `${SENTINEL_ONBOARDING_HASH_PREFIX.slice(1)}${packageCode}`
  return url.toString()
}

export function consumeSentinelOnboardingFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  if (!url.hash.startsWith(SENTINEL_ONBOARDING_HASH_PREFIX)) return ''
  const encoded = url.hash.slice(SENTINEL_ONBOARDING_HASH_PREFIX.length)
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return ''
    url.hash = ''
    history.replaceState(undefined, '', `${url.pathname}${url.search}`)
    return encoded
  } catch {
    return ''
  }
}
