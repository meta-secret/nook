import { Schema } from 'effect'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import { ExtensionSessionLifecycleMessageType } from '../../lib/extension-session-lifecycle-message-type'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'

export type ExtensionSessionEnsureMessage = {
  type: ExtensionRuntimeRequestType.EnsureRuntime
}

export type ExtensionAuthenticationSurfacesRefreshMessage = {
  type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
}

export type ExtensionSessionExpiryMessage = {
  type: ExtensionSessionLifecycleMessageType.Expired
}

export type ExtensionSessionLockMessage = {
  type: ExtensionSessionMessageType.Lock
}

export type ExtensionSessionRuntimeMessageValue = BrowserRuntimeMessage

const extensionSessionEnsureMessageSchema = Schema.Struct({
  type: Schema.Literal(ExtensionRuntimeRequestType.EnsureRuntime),
}) satisfies Schema.Schema<ExtensionSessionEnsureMessage>

const extensionAuthenticationSurfacesRefreshMessageSchema = Schema.Struct({
  type: Schema.Literal(ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces),
}) satisfies Schema.Schema<ExtensionAuthenticationSurfacesRefreshMessage>

const extensionSessionExpiryMessageSchema = Schema.Struct({
  type: Schema.Literal(ExtensionSessionLifecycleMessageType.Expired),
}) satisfies Schema.Schema<ExtensionSessionExpiryMessage>

const extensionSessionLockMessageSchema = Schema.Struct({
  type: Schema.Literal(ExtensionSessionMessageType.Lock),
}) satisfies Schema.Schema<ExtensionSessionLockMessage>

export function decodeExtensionSessionEnsureMessage(
  message: ExtensionSessionRuntimeMessageValue,
) {
  return Schema.decodeUnknown(extensionSessionEnsureMessageSchema)(message)
}

export function decodeExtensionAuthenticationSurfacesRefreshMessage(
  message: ExtensionSessionRuntimeMessageValue,
) {
  return Schema.decodeUnknown(
    extensionAuthenticationSurfacesRefreshMessageSchema,
  )(message)
}

export function decodeExtensionSessionExpiryMessage(
  message: ExtensionSessionRuntimeMessageValue,
) {
  return Schema.decodeUnknown(extensionSessionExpiryMessageSchema)(message)
}

export function decodeExtensionSessionLockMessage(
  message: ExtensionSessionRuntimeMessageValue,
) {
  return Schema.decodeUnknown(extensionSessionLockMessageSchema)(message)
}
