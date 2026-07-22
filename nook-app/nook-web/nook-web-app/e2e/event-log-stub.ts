import type { Route } from '@playwright/test'

export const EVENT_DIGEST_PATTERN = '[A-Za-z0-9_-]{43}'

export function parseEventMultipart(
  body: string,
): { digest: string; content: string } | undefined {
  const eventId = body.match(
    new RegExp(`"event_id"\\s*:\\s*"sha256u:(${EVENT_DIGEST_PATTERN})"`),
  )?.[1]
  const nameDigest = body.match(
    new RegExp(`"name"\\s*:\\s*"(${EVENT_DIGEST_PATTERN})\\.yaml"`),
  )?.[1]
  const digest = eventId ?? nameDigest
  if (!digest) return undefined
  const markers = [
    '\r\nContent-Type: application/x-yaml\r\n\r\n',
    '\r\nContent-Type: application/json\r\n\r\n',
  ]
  const marker = markers.find((candidate) => body.includes(candidate))
  if (!marker) return undefined
  const contentStart = body.indexOf(marker) + marker.length
  const end = body.indexOf('\r\n--nook_event_boundary--', contentStart)
  const content =
    end === -1 ? body.slice(contentStart) : body.slice(contentStart, end)
  return { digest, content }
}

export async function fulfillEventMetadata(
  route: Route,
  id: string,
  digest: string,
  checksumPrefix: string,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id,
      name: `${digest}.yaml`,
      md5Checksum: `${checksumPrefix}${digest}`,
    }),
  })
}
