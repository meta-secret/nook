import { OriginRuntimeMessage as OriginRuntimeMessageSchema } from './origin-runtime-message'

import type { WebsiteAuthenticatorOption } from './login-fill-messages'

export const MAX_AUTHENTICATOR_SEARCH_LENGTH = 200

export enum WebsiteAuthenticatorPickerOpenMessageType {
  NookWebsiteAuthenticatorPickerOpen = 'nook:website-authenticator-picker-open',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorPickerOpenMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen
  declare readonly payload: {
    origin: string
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorPickerOpenMessage {
    return (
      OriginRuntimeMessageSchema.is(message) &&
      message.type ===
        WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen
    )
  }
}

export enum AuthenticatorPickerQueryMessageType {
  NookAuthenticatorPickerQuery = 'nook:authenticator-picker-query',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticatorPickerQueryMessage {
  private constructor() {}
  declare readonly type: AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery
  declare readonly payload: {
    requestId: string
    query: string
  }
  static isNonEmptyString(value: string): value is string {
    return typeof value === 'string' && value.length > 0
  }

  static is(message: unknown): message is AuthenticatorPickerQueryMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !==
        AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const payload =
      message.payload as AuthenticatorPickerQueryMessage['payload']

    return (
      AuthenticatorPickerQueryMessage.isNonEmptyString(payload.requestId) &&
      typeof payload.query === 'string' &&
      payload.query.length <= MAX_AUTHENTICATOR_SEARCH_LENGTH
    )
  }
}

export enum AuthenticatorPickerSelectMessageType {
  NookAuthenticatorPickerSelect = 'nook:authenticator-picker-select',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticatorPickerSelectMessage {
  private constructor() {}
  declare readonly type: AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect
  declare readonly payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
  static is(message: unknown): message is AuthenticatorPickerSelectMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !==
        AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const payload =
      message.payload as AuthenticatorPickerSelectMessage['payload']

    return (
      AuthenticatorPickerQueryMessage.isNonEmptyString(payload.requestId) &&
      AuthenticatorPickerQueryMessage.isNonEmptyString(payload.vaultStoreId) &&
      AuthenticatorPickerQueryMessage.isNonEmptyString(payload.secretId)
    )
  }
}

export enum AuthenticatorPickerCancelMessageType {
  NookAuthenticatorPickerCancel = 'nook:authenticator-picker-cancel',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticatorPickerCancelMessage {
  private constructor() {}
  declare readonly type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel
  declare readonly payload: {
    requestId: string
  }
  static is(message: unknown): message is AuthenticatorPickerCancelMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !==
        AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const payload =
      message.payload as AuthenticatorPickerCancelMessage['payload']

    return AuthenticatorPickerQueryMessage.isNonEmptyString(payload.requestId)
  }
}

export enum WebsiteAuthenticatorSelectedMessageType {
  NookWebsiteAuthenticatorSelected = 'nook:website-authenticator-selected',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorSelectedMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected
  declare readonly payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'> & {
      authorizationGeneration: string
    }
  }
  static is(message: unknown): message is WebsiteAuthenticatorSelectedMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !==
        WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorSelectedMessage['payload']

    if (
      !AuthenticatorPickerQueryMessage.isNonEmptyString(payload.origin) ||
      !AuthenticatorPickerQueryMessage.isNonEmptyString(payload.requestId) ||
      !payload.account ||
      typeof payload.account !== 'object'
    ) {
      return false
    }
    const account =
      payload.account as WebsiteAuthenticatorSelectedMessage['payload']['account']

    return (
      AuthenticatorPickerQueryMessage.isNonEmptyString(account.vaultStoreId) &&
      AuthenticatorPickerQueryMessage.isNonEmptyString(account.secretId) &&
      typeof account.authorizationGeneration === 'string' &&
      account.authorizationGeneration.length > 0
    )
  }
}

export enum WebsiteAuthenticatorCanceledMessageType {
  NookWebsiteAuthenticatorCanceled = 'nook:website-authenticator-canceled',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorCanceledMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled
  declare readonly payload: {
    origin: string
    requestId: string
  }
  static is(message: unknown): message is WebsiteAuthenticatorCanceledMessage {
    if (!OriginRuntimeMessageSchema.is(message)) return false
    const payload =
      message.payload as WebsiteAuthenticatorCanceledMessage['payload']

    return (
      message.type ===
        WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled &&
      AuthenticatorPickerQueryMessage.isNonEmptyString(payload.requestId)
    )
  }
}
