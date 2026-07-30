export enum ExtensionMetadataStateKind {
  Loading = 'loading',
  Unavailable = 'unavailable',
  Loaded = 'loaded',
}

export type ExtensionMetadataState<Metadata> =
  | { kind: ExtensionMetadataStateKind.Loading }
  | { kind: ExtensionMetadataStateKind.Unavailable }
  | {
      kind: ExtensionMetadataStateKind.Loaded
      metadata: Metadata
    }

export function loadingExtensionMetadata<
  Metadata,
>(): ExtensionMetadataState<Metadata> {
  return { kind: ExtensionMetadataStateKind.Loading }
}

export function unavailableExtensionMetadata<
  Metadata,
>(): ExtensionMetadataState<Metadata> {
  return { kind: ExtensionMetadataStateKind.Unavailable }
}

export function loadedExtensionMetadata<Metadata>(
  metadata: Metadata,
): ExtensionMetadataState<Metadata> {
  return { kind: ExtensionMetadataStateKind.Loaded, metadata }
}
