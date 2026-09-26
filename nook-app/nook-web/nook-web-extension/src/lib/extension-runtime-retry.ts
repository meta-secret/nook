import { ExtensionSessionRuntimeClosed } from './nook-wasm'

/** A close revokes the old request; only a fresh request may open a new session. */
export async function retryClosedExtensionSessionOnce<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (failure) {
    if (!(failure instanceof ExtensionSessionRuntimeClosed)) throw failure
    return operation()
  }
}
