interface RegistryDescriptor {
  digest: string
  mediaType: string
  size: number
}

interface RegistryDocument {
  config?: RegistryDescriptor
  layers?: RegistryDescriptor[]
  manifests?: RegistryDescriptor[]
}

interface RegistryLocation {
  host: string
  reference: string
  repository: string
}

interface RegistryRequest {
  method?: string
  path: string
  range?: string
}

const registryRef = process.argv[2]
if (!registryRef) {
  throw new Error('usage: bun verify-registry-cache-blobs.ts <registry-ref>')
}

const parseLocation = (ref: string): RegistryLocation => {
  const slash = ref.indexOf('/')
  const colon = ref.lastIndexOf(':')
  if (slash < 1 || colon <= slash + 1) {
    throw new Error(`invalid registry cache ref: ${ref}`)
  }
  return {
    host: ref.slice(0, slash),
    repository: ref.slice(slash + 1, colon),
    reference: ref.slice(colon + 1),
  }
}

const location = parseLocation(registryRef)
const username = process.env.NOOK_REGISTRY_USERNAME
const password = process.env.NOOK_REGISTRY_PASSWORD
if (!username || !password) {
  throw new Error('registry blob verification requires NOOK_REGISTRY_USERNAME and NOOK_REGISTRY_PASSWORD')
}
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

const registryRequest = async (input: RegistryRequest): Promise<Response> => {
  const headers = new Headers()
  headers.set('Authorization', authorization)
  if (input.path.startsWith('manifests/')) {
    headers.set(
      'Accept',
      'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
    )
  }
  if (input.range) headers.set('Range', input.range)
  const init: RequestInit = { headers, method: input.method ?? 'GET' }
  const response = await fetch(`https://${location.host}/v2/${location.repository}/${input.path}`, init)
  if (!response.ok) {
    throw new Error(`registry ${init.method} ${input.path} failed with HTTP ${response.status}`)
  }
  return response
}

const descriptors = new Map<string, RegistryDescriptor>()
const visitedManifests = new Set<string>()
const manifestRequest = (reference: string): RegistryRequest => ({ path: `manifests/${reference}` })
const blobHeadRequest = (path: string): RegistryRequest => ({ method: 'HEAD', path })
const blobByteRequest = (path: string): RegistryRequest => ({ path, range: 'bytes=0-0' })

const collectManifest = async (reference: string): Promise<void> => {
  if (visitedManifests.has(reference)) return
  visitedManifests.add(reference)
  const response = await registryRequest(manifestRequest(reference))
  const document = JSON.parse(await response.text()) as RegistryDocument
  if (document.config) descriptors.set(document.config.digest, document.config)
  for (const layer of document.layers ?? []) descriptors.set(layer.digest, layer)
  for (const manifest of document.manifests ?? []) await collectManifest(manifest.digest)
}

const verifyBlob = async (descriptor: RegistryDescriptor): Promise<void> => {
  if (!/^sha256:[0-9a-f]{64}$/.test(descriptor.digest) || descriptor.size < 0) {
    throw new Error(`invalid registry descriptor: ${JSON.stringify(descriptor)}`)
  }
  const path = `blobs/${descriptor.digest}`
  const head = await registryRequest(blobHeadRequest(path))
  const contentLength = Number(head.headers.get('content-length'))
  if (contentLength !== descriptor.size) {
    throw new Error(`${descriptor.digest} has ${contentLength} bytes; manifest requires ${descriptor.size}`)
  }
  if (descriptor.size === 0) return
  const firstByte = await registryRequest(blobByteRequest(path))
  const reader = firstByte.body?.getReader()
  if (!reader) throw new Error(`${descriptor.digest} has no readable response body`)
  const chunk = await reader.read()
  await reader.cancel()
  if (chunk.done || chunk.value.length === 0) {
    throw new Error(`${descriptor.digest} did not return a readable byte`)
  }
}

await collectManifest(location.reference)
if (descriptors.size === 0) throw new Error(`${registryRef} contains no cache blob descriptors`)
for (const descriptor of descriptors.values()) await verifyBlob(descriptor)
let totalBytes = 0
for (const descriptor of descriptors.values()) totalBytes += descriptor.size
console.log(`verified ${descriptors.size} readable registry blobs (${totalBytes} declared bytes) for ${registryRef}`)
