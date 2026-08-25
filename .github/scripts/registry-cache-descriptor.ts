export interface RegistryDescriptor {
  digest: string
  mediaType: string
  size: number
}

export interface RegistryDescriptorRegistration {
  collection: Map<string, RegistryDescriptor>
  descriptor: RegistryDescriptor
  kind: 'blob' | 'manifest'
}

export function registerRegistryDescriptor(input: RegistryDescriptorRegistration): void {
  const existing = input.collection.get(input.descriptor.digest)
  if (
    existing &&
    (existing.size !== input.descriptor.size || existing.mediaType !== input.descriptor.mediaType)
  ) {
    throw new Error(
      `${input.descriptor.digest} has conflicting ${input.kind} descriptors: ${JSON.stringify(existing)} and ${JSON.stringify(input.descriptor)}`,
    )
  }
  input.collection.set(input.descriptor.digest, input.descriptor)
}
