import { Schema } from 'effect'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import { ExtensionSessionLifecycleMessageType } from '../../lib/extension-session-lifecycle-message-type'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'

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
  type: typeof ExtensionSessionMessageType.Lock
}

export type ExtensionSessionRuntimeMessageInput = {
  readonly [key: string]: BrowserRuntimeMessageValue
}

export type ExtensionSessionRuntimeMessageValue = BrowserRuntimeMessageValue

type ExtensionSessionEnsureMessageSchemaFields = {
  readonly type: Schema.Schema<ExtensionSessionEnsureMessage['type']>
}
const extensionSessionEnsureMessageSchemaFields: ExtensionSessionEnsureMessageSchemaFields =
  {
    type: Schema.Literal(ExtensionRuntimeRequestType.EnsureRuntime),
  }
const extensionSessionEnsureMessageSchema = Schema.Struct(
  extensionSessionEnsureMessageSchemaFields,
) satisfies Schema.Schema<ExtensionSessionEnsureMessage>

type ExtensionAuthenticationSurfacesRefreshMessageSchemaFields = {
  readonly type: Schema.Schema<
    ExtensionAuthenticationSurfacesRefreshMessage['type']
  >
}
const extensionAuthenticationSurfacesRefreshMessageSchemaFields: ExtensionAuthenticationSurfacesRefreshMessageSchemaFields =
  {
    type: Schema.Literal(
      ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
    ),
  }
const extensionAuthenticationSurfacesRefreshMessageSchema = Schema.Struct(
  extensionAuthenticationSurfacesRefreshMessageSchemaFields,
) satisfies Schema.Schema<ExtensionAuthenticationSurfacesRefreshMessage>

type ExtensionSessionExpiryMessageSchemaFields = {
  readonly type: Schema.Schema<ExtensionSessionExpiryMessage['type']>
}
const extensionSessionExpiryMessageSchemaFields: ExtensionSessionExpiryMessageSchemaFields =
  {
    type: Schema.Literal(ExtensionSessionLifecycleMessageType.Expired),
  }
const extensionSessionExpiryMessageSchema = Schema.Struct(
  extensionSessionExpiryMessageSchemaFields,
) satisfies Schema.Schema<ExtensionSessionExpiryMessage>

type ExtensionSessionLockMessageSchemaFields = {
  readonly type: Schema.Schema<ExtensionSessionLockMessage['type']>
}
const extensionSessionLockMessageSchemaFields: ExtensionSessionLockMessageSchemaFields =
  {
    type: Schema.Literal(ExtensionSessionMessageType.Lock),
  }
const extensionSessionLockMessageSchema = Schema.Struct(
  extensionSessionLockMessageSchemaFields,
) satisfies Schema.Schema<ExtensionSessionLockMessage>

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
