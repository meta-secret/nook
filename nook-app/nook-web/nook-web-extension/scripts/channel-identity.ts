import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'

export type ExtensionChannel =
  | 'production'
  | 'development'
  | 'local'
  | `pr-${number}`

export type ExtensionChannelIdentity = {
  channel: ExtensionChannel
  extensionId: string
  manifestKey: string
  name: string
  shortName: string
}

const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
)
const EXTENSION_ID_ALPHABET = 'abcdefghijklmnop'

export function parseExtensionChannel(value: string): ExtensionChannel {
  const channel = value.trim().toLowerCase()
  if (
    channel === 'production' ||
    channel === 'development' ||
    channel === 'local'
  ) {
    return channel
  }
  if (/^pr-[1-9][0-9]*$/.test(channel)) {
    return channel as `pr-${number}`
  }
  throw new Error(
    'NOOK_EXTENSION_CHANNEL must be production, development, local, or pr-<number>.',
  )
}

function manifestKeyForChannel(channel: ExtensionChannel): Buffer {
  const seed = createHash('sha256')
    .update(`nook/passwords/extension-channel/v1/${channel}`)
    .digest()
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  })
  return createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  }) as Buffer
}

export function extensionIdFromManifestKey(manifestKey: string): string {
  const digest = createHash('sha256')
    .update(Buffer.from(manifestKey, 'base64'))
    .digest()
    .subarray(0, 16)
  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => EXTENSION_ID_ALPHABET[nibble])
    .join('')
}

export function extensionChannelIdentity(
  channelValue: string,
): ExtensionChannelIdentity {
  const channel = parseExtensionChannel(channelValue)
  const manifestKey = manifestKeyForChannel(channel).toString('base64')
  const suffix =
    channel === 'production'
      ? ''
      : channel === 'development'
        ? ' (Development)'
        : channel === 'local'
          ? ' (Local)'
          : ` (${channel.toUpperCase()})`
  return {
    channel,
    extensionId: extensionIdFromManifestKey(manifestKey),
    manifestKey,
    name: `Nook Passwords${suffix}`,
    shortName: channel === 'production' ? 'Nook' : 'Nook Dev',
  }
}
