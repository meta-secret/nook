import { OriginRuntimeMessage as OriginRuntimeMessageSchema } from './origin-runtime-message'

export type {
  WebsiteLoginAccountOption,
  WebsiteAuthenticatorOption,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type WebsiteLoginFillResponse =
  | { ok: true; username: string; password: string }
  | { ok: false; reason: string }

export enum WebsiteAuthenticatorResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export enum WebsiteLoginOptionsMessageType {
  NookWebsiteLoginOptions = 'nook:website-login-options',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginOptionsMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions
  declare readonly payload: {
    origin: string
  }
  static isWebsiteLoginFillResponse(
    response: unknown,
  ): response is WebsiteLoginFillResponse {
    if (!response || typeof response !== 'object') return false
    if (!('ok' in response) || typeof response.ok !== 'boolean') return false
    if (!response.ok) {
      return 'reason' in response && typeof response.reason === 'string'
    }
    return (
      'username' in response &&
      typeof response.username === 'string' &&
      'password' in response &&
      typeof response.password === 'string'
    )
  }

  static is(message: unknown): message is WebsiteLoginOptionsMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions ||
      !('payload' in message) ||
      typeof message.payload !== 'object' ||
      !message.payload
    ) {
      return false
    }
    const { payload } = message

    return (
      'origin' in payload &&
      typeof payload.origin === 'string' &&
      payload.origin.length > 0
    )
  }
}

export enum WebsiteLoginRevealMessageType {
  NookWebsiteLoginFill = 'nook:website-login-fill',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginRevealMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    authorizationGeneration: string
  }
  static is(message: unknown): message is WebsiteLoginRevealMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== WebsiteLoginRevealMessageType.NookWebsiteLoginFill ||
      !('payload' in message) ||
      typeof message.payload !== 'object' ||
      !message.payload
    ) {
      return false
    }
    const { payload } = message

    return (
      'origin' in payload &&
      typeof payload.origin === 'string' &&
      payload.origin.length > 0 &&
      'vaultStoreId' in payload &&
      typeof payload.vaultStoreId === 'string' &&
      payload.vaultStoreId.length > 0 &&
      'secretId' in payload &&
      typeof payload.secretId === 'string' &&
      payload.secretId.length > 0 &&
      (!('authorizationGeneration' in payload) ||
        (typeof payload.authorizationGeneration === 'string' &&
          payload.authorizationGeneration.length > 0))
    )
  }
}

export enum WebsiteAuthenticatorOptionsMessageType {
  NookWebsiteAuthenticatorOptions = 'nook:website-authenticator-options',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorOptionsMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions
  declare readonly payload: {
    origin: string
  }
  static is(message: unknown): message is WebsiteAuthenticatorOptionsMessage {
    return (
      OriginRuntimeMessageSchema.is(message) &&
      message.type ===
        WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions
    )
  }
}

export enum WebsiteAuthenticatorFillMessageType {
  NookWebsiteAuthenticatorFill = 'nook:website-authenticator-fill',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorFillMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    authorizationGeneration?: string
  }
  static is(message: unknown): message is WebsiteAuthenticatorFillMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill
    ) {
      return false
    }
    const { payload } = message

    return (
      'vaultStoreId' in payload &&
      typeof payload.vaultStoreId === 'string' &&
      payload.vaultStoreId.length > 0 &&
      'secretId' in payload &&
      typeof payload.secretId === 'string' &&
      payload.secretId.length > 0 &&
      'authorizationGeneration' in payload &&
      typeof payload.authorizationGeneration === 'string' &&
      payload.authorizationGeneration.length > 0
    )
  }
}
