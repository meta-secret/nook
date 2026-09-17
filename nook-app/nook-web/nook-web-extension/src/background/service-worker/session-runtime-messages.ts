import { Schema } from 'effect'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import { ExtensionSessionLifecycleMessageType } from '../../lib/extension-session-lifecycle-message-type'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'

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

export type ExtensionSessionRuntimeMessageInput = {
  [key: string]:
    | string
    | number
    | boolean
    | ExtensionSessionRuntimeMessageInput
    | ExtensionSessionRuntimeMessageInput[]
}

export type ExtensionSessionRuntimeMessageValue =
  | ExtensionSessionRuntimeMessageInput
  | ExtensionSessionRuntimeMessageInput[]
  | string
  | number
  | boolean

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

export function decodeExtensionSessionEnsureMessage(message: unknown) {
  return Schema.decodeUnknown(extensionSessionEnsureMessageSchema)(message)
}

export function decodeExtensionAuthenticationSurfacesRefreshMessage(
  message: unknown,
) {
  return Schema.decodeUnknown(
    extensionAuthenticationSurfacesRefreshMessageSchema,
  )(message)
}

export function decodeExtensionSessionExpiryMessage(message: unknown) {
  return Schema.decodeUnknown(extensionSessionExpiryMessageSchema)(message)
}

export function decodeExtensionSessionLockMessage(message: unknown) {
  return Schema.decodeUnknown(extensionSessionLockMessageSchema)(message)
}
