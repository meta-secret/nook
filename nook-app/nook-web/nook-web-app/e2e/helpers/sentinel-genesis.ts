import { generateKeyPairSync, webcrypto } from 'node:crypto'

export async function signedSentinelInvitation(): Promise<string> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signingPublicKey = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('hex')
  const request = {
    version: 1,
    sessionId: 'abcdefghijk',
    policy: { participantCount: 3, threshold: 2 },
    initiatorDeviceId: '0123456789abcdef',
    initiatorSigningPublicKey: signingPublicKey,
  }
  const signingKey = await webcrypto.subtle.importKey(
    'pkcs8',
    privateKey.export({ format: 'der', type: 'pkcs8' }),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  const signaturePayload = Buffer.from(
    JSON.stringify([
      request.version,
      request.sessionId,
      request.policy,
      request.initiatorDeviceId,
      request.initiatorSigningPublicKey,
    ]),
  )
  const signature = Buffer.from(
    await webcrypto.subtle.sign('Ed25519', signingKey, signaturePayload),
  ).toString('hex')
  return JSON.stringify({ ...request, signature })
}
