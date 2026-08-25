import { describe, expect, test } from 'bun:test'

import {
  registerRegistryDescriptor,
  type RegistryDescriptor,
  type RegistryDescriptorRegistration,
  RegistryDescriptorKind,
} from './registry-cache-descriptor'

const digest = `sha256:${'a'.repeat(64)}`
const descriptor: RegistryDescriptor = {
  digest,
  mediaType: 'application/vnd.oci.image.layer.v1.tar+zstd',
  size: 42,
}

function register(input: {
  collection: Map<string, RegistryDescriptor>
  descriptor: RegistryDescriptor
}): void {
  const registration: RegistryDescriptorRegistration = {
    collection: input.collection,
    descriptor: input.descriptor,
    kind: RegistryDescriptorKind.Blob,
  }
  registerRegistryDescriptor(registration)
}

describe('registry cache descriptor registration', () => {
  test('deduplicates identical descriptors', () => {
    const collection = new Map<string, RegistryDescriptor>()
    const first = { collection, descriptor }
    const duplicate = { collection, descriptor: { ...descriptor } }
    register(first)
    register(duplicate)
    expect(collection.size).toBe(1)
  })

  test('rejects a duplicate digest with a conflicting size', () => {
    const collection = new Map<string, RegistryDescriptor>()
    const first = { collection, descriptor }
    const conflict = { collection, descriptor: { ...descriptor, size: 43 } }
    register(first)
    expect(() => register(conflict)).toThrow('conflicting blob descriptors')
  })

  test('rejects a duplicate digest with a conflicting media type', () => {
    const collection = new Map<string, RegistryDescriptor>()
    const first = { collection, descriptor }
    const conflict = {
      collection,
      descriptor: { ...descriptor, mediaType: 'application/vnd.oci.image.config.v1+json' },
    }
    register(first)
    expect(() => register(conflict)).toThrow('conflicting blob descriptors')
  })
})
