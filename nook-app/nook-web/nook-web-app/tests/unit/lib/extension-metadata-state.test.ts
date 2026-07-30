import { describe, expect, test } from 'vitest'
import {
  ExtensionMetadataStateKind,
  loadedExtensionMetadata,
  loadingExtensionMetadata,
  unavailableExtensionMetadata,
} from '../../../src/landing/extension-metadata-state'

describe('extension metadata presentation state', () => {
  test('models loading, unavailable, and loaded states explicitly', () => {
    expect(loadingExtensionMetadata()).toEqual({
      kind: ExtensionMetadataStateKind.Loading,
    })
    expect(unavailableExtensionMetadata()).toEqual({
      kind: ExtensionMetadataStateKind.Unavailable,
    })
    expect(loadedExtensionMetadata({ version: '1.2.3' })).toEqual({
      kind: ExtensionMetadataStateKind.Loaded,
      metadata: { version: '1.2.3' },
    })
  })
})
