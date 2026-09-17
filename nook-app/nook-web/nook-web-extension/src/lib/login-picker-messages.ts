import { OriginRuntimeMessage as OriginRuntimeMessageSchema } from './origin-runtime-message'

import type { WebsiteLoginAccountOption } from './login-fill-messages'

export const MAX_LOGIN_SEARCH_LENGTH = 200

export enum WebsiteLoginPickerOpenMessageType {
  NookWebsiteLoginPickerOpen = 'nook:website-login-picker-open',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginPickerOpenMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen
  declare readonly payload: {
    origin: string
  }
  static is(message: unknown): message is WebsiteLoginPickerOpenMessage {
    return (
      OriginRuntimeMessageSchema.is(message) &&
      message.type ===
        WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen
    )
  }
}

export enum LoginPickerQueryMessageType {
  NookLoginPickerQuery = 'nook:login-picker-query',
}

/** Owns admission of the concrete browser response returned for one query. */
export class LoginPickerQueryResponse {
  private constructor() {}
  declare readonly ok: true
  declare readonly origin: string
  declare readonly accounts: WebsiteLoginAccountOption[]

  static is(response: unknown): response is LoginPickerQueryResponse {
    if (
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response) ||
      !('ok' in response) ||
      response.ok !== true ||
      !('origin' in response) ||
      typeof response.origin !== 'string' ||
      response.origin.length === 0 ||
      !('accounts' in response) ||
      !Array.isArray(response.accounts)
    ) {
      return false
    }
    const accounts: unknown[] = response.accounts
    return accounts.every((account: unknown) => {
      if (!account || typeof account !== 'object' || Array.isArray(account))
        return false
      return (
        'vaultStoreId' in account &&
        typeof account.vaultStoreId === 'string' &&
        account.vaultStoreId.length > 0 &&
        'secretId' in account &&
        typeof account.secretId === 'string' &&
        account.secretId.length > 0 &&
        'username' in account &&
        typeof account.username === 'string' &&
        'websiteHost' in account &&
        typeof account.websiteHost === 'string' &&
        'vaultName' in account &&
        typeof account.vaultName === 'string'
      )
    })
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerQueryMessage {
  private constructor() {}
  declare readonly type: LoginPickerQueryMessageType.NookLoginPickerQuery
  declare readonly payload: {
    requestId: string
    query: string
  }
  static isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0
  }

  static is(message: unknown): message is LoginPickerQueryMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== LoginPickerQueryMessageType.NookLoginPickerQuery ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const { payload } = message
    return (
      'requestId' in payload &&
      LoginPickerQueryMessage.isNonEmptyString(payload.requestId) &&
      'query' in payload &&
      typeof payload.query === 'string' &&
      payload.query.length <= MAX_LOGIN_SEARCH_LENGTH
    )
  }
}

export enum LoginPickerSelectMessageType {
  NookLoginPickerSelect = 'nook:login-picker-select',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerSelectMessage {
  private constructor() {}
  declare readonly type: LoginPickerSelectMessageType.NookLoginPickerSelect
  declare readonly payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
  static is(message: unknown): message is LoginPickerSelectMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== LoginPickerSelectMessageType.NookLoginPickerSelect ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const { payload } = message

    return (
      'requestId' in payload &&
      LoginPickerQueryMessage.isNonEmptyString(payload.requestId) &&
      'vaultStoreId' in payload &&
      LoginPickerQueryMessage.isNonEmptyString(payload.vaultStoreId) &&
      'secretId' in payload &&
      LoginPickerQueryMessage.isNonEmptyString(payload.secretId)
    )
  }
}

export enum LoginPickerCancelMessageType {
  NookLoginPickerCancel = 'nook:login-picker-cancel',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerCancelMessage {
  private constructor() {}
  declare readonly type: LoginPickerCancelMessageType.NookLoginPickerCancel
  declare readonly payload: {
    requestId: string
  }
  static is(message: unknown): message is LoginPickerCancelMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== LoginPickerCancelMessageType.NookLoginPickerCancel ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const { payload } = message

    return (
      'requestId' in payload &&
      LoginPickerQueryMessage.isNonEmptyString(payload.requestId)
    )
  }
}

export enum WebsiteLoginSelectedMessageType {
  NookWebsiteLoginSelected = 'nook:website-login-selected',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginSelectedMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected
  declare readonly payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'> & {
      authorizationGeneration: string
    }
  }
  static is(message: unknown): message is WebsiteLoginSelectedMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !==
        WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object'
    ) {
      return false
    }
    const { payload } = message

    if (
      !('origin' in payload) ||
      !LoginPickerQueryMessage.isNonEmptyString(payload.origin) ||
      !('requestId' in payload) ||
      !LoginPickerQueryMessage.isNonEmptyString(payload.requestId) ||
      !('account' in payload) ||
      !payload.account ||
      typeof payload.account !== 'object'
    ) {
      return false
    }
    const { account } = payload

    return (
      'vaultStoreId' in account &&
      LoginPickerQueryMessage.isNonEmptyString(account.vaultStoreId) &&
      'secretId' in account &&
      LoginPickerQueryMessage.isNonEmptyString(account.secretId) &&
      'authorizationGeneration' in account &&
      typeof account.authorizationGeneration === 'string' &&
      account.authorizationGeneration.length > 0
    )
  }
}

export enum WebsiteLoginCanceledMessageType {
  NookWebsiteLoginCanceled = 'nook:website-login-canceled',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginCanceledMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled
  declare readonly payload: {
    origin: string
    requestId: string
  }
  static is(message: unknown): message is WebsiteLoginCanceledMessage {
    if (!OriginRuntimeMessageSchema.is(message)) return false
    const { payload } = message

    return (
      message.type ===
        WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled &&
      'requestId' in payload &&
      LoginPickerQueryMessage.isNonEmptyString(payload.requestId)
    )
  }
}
